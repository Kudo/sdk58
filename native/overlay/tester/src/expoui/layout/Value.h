// A small JSON value (null, bool, number, string, array, object) with a parser and a
// serializer. STL only. Used for @expo/ui props and modifier params, which the host gets as
// `folly::dynamic` and tests read from JSON files.

#pragma once

#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace expoui::layout {

class Value;
using Array = std::vector<Value>;
using Object = std::map<std::string, Value>;

class Value {
 public:
  using Storage =
      std::variant<std::nullptr_t, bool, double, std::string, std::shared_ptr<Array>, std::shared_ptr<Object>>;

  Value() : storage_(nullptr) {}
  Value(std::nullptr_t) : storage_(nullptr) {}
  Value(bool b) : storage_(b) {}
  Value(double d) : storage_(d) {}
  Value(int i) : storage_(static_cast<double>(i)) {}
  Value(const char* s) : storage_(std::string(s)) {}
  Value(std::string s) : storage_(std::move(s)) {}
  Value(Array a) : storage_(std::make_shared<Array>(std::move(a))) {}
  Value(Object o) : storage_(std::make_shared<Object>(std::move(o))) {}

  bool isNull() const { return std::holds_alternative<std::nullptr_t>(storage_); }
  bool isBool() const { return std::holds_alternative<bool>(storage_); }
  bool isNumber() const { return std::holds_alternative<double>(storage_); }
  bool isString() const { return std::holds_alternative<std::string>(storage_); }
  bool isArray() const { return std::holds_alternative<std::shared_ptr<Array>>(storage_); }
  bool isObject() const { return std::holds_alternative<std::shared_ptr<Object>>(storage_); }

  bool asBool(bool fallback = false) const { return isBool() ? std::get<bool>(storage_) : fallback; }
  double asNumber(double fallback = 0) const { return isNumber() ? std::get<double>(storage_) : fallback; }
  const std::string& asString() const {
    static const std::string empty;
    return isString() ? std::get<std::string>(storage_) : empty;
  }
  const Array& asArray() const {
    static const Array empty;
    return isArray() ? *std::get<std::shared_ptr<Array>>(storage_) : empty;
  }
  const Object& asObject() const {
    static const Object empty;
    return isObject() ? *std::get<std::shared_ptr<Object>>(storage_) : empty;
  }

  /// Member of an object, or null.
  const Value& operator[](const std::string& key) const {
    static const Value null;
    if (!isObject()) {
      return null;
    }
    const auto& object = asObject();
    auto it = object.find(key);
    return it == object.end() ? null : it->second;
  }

  /// A number, where JS `Infinity` may arrive as the string "infinity" (JSON has no Infinity) or
  /// as a number >= 1e9. Returns nullopt for anything else.
  std::optional<double> length() const {
    if (isNumber()) {
      double d = asNumber();
      return d >= 1e9 ? std::numeric_limits<double>::infinity() : d;
    }
    if (isString()) {
      std::string s = asString();
      for (auto& c : s) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      }
      if (s == "infinity") {
        return std::numeric_limits<double>::infinity();
      }
    }
    return std::nullopt;
  }

  static Value parse(const std::string& text) {
    Parser parser{text, 0};
    Value value = parser.parseValue();
    parser.skipWhitespace();
    if (parser.pos != text.size()) {
      throw std::runtime_error("JSON: trailing characters at " + std::to_string(parser.pos));
    }
    return value;
  }

  std::string serialize(int indent = -1) const {
    std::string out;
    write(out, indent, 0);
    return out;
  }

 private:
  Storage storage_;

  struct Parser {
    const std::string& text;
    size_t pos;

    void skipWhitespace() {
      while (pos < text.size() && std::isspace(static_cast<unsigned char>(text[pos]))) {
        pos++;
      }
    }

    [[noreturn]] void fail(const char* what) const {
      throw std::runtime_error(std::string("JSON: ") + what + " at " + std::to_string(pos));
    }

    Value parseValue() {
      skipWhitespace();
      if (pos >= text.size()) {
        fail("unexpected end");
      }
      char c = text[pos];
      if (c == '{') {
        pos++;
        Object object;
        skipWhitespace();
        if (pos < text.size() && text[pos] == '}') {
          pos++;
          return Value(std::move(object));
        }
        while (true) {
          skipWhitespace();
          std::string key = parseString();
          skipWhitespace();
          if (pos >= text.size() || text[pos] != ':') {
            fail("expected ':'");
          }
          pos++;
          object[key] = parseValue();
          skipWhitespace();
          if (pos < text.size() && text[pos] == ',') {
            pos++;
            continue;
          }
          if (pos < text.size() && text[pos] == '}') {
            pos++;
            return Value(std::move(object));
          }
          fail("expected ',' or '}'");
        }
      }
      if (c == '[') {
        pos++;
        Array array;
        skipWhitespace();
        if (pos < text.size() && text[pos] == ']') {
          pos++;
          return Value(std::move(array));
        }
        while (true) {
          array.push_back(parseValue());
          skipWhitespace();
          if (pos < text.size() && text[pos] == ',') {
            pos++;
            continue;
          }
          if (pos < text.size() && text[pos] == ']') {
            pos++;
            return Value(std::move(array));
          }
          fail("expected ',' or ']'");
        }
      }
      if (c == '"') {
        return Value(parseString());
      }
      if (text.compare(pos, 4, "true") == 0) {
        pos += 4;
        return Value(true);
      }
      if (text.compare(pos, 5, "false") == 0) {
        pos += 5;
        return Value(false);
      }
      if (text.compare(pos, 4, "null") == 0) {
        pos += 4;
        return Value(nullptr);
      }
      size_t start = pos;
      while (pos < text.size() && (std::isdigit(static_cast<unsigned char>(text[pos])) || text[pos] == '-' ||
                                   text[pos] == '+' || text[pos] == '.' || text[pos] == 'e' || text[pos] == 'E')) {
        pos++;
      }
      if (start == pos) {
        fail("unexpected character");
      }
      return Value(std::stod(text.substr(start, pos - start)));
    }

    std::string parseString() {
      if (pos >= text.size() || text[pos] != '"') {
        fail("expected string");
      }
      pos++;
      std::string out;
      while (pos < text.size() && text[pos] != '"') {
        char c = text[pos++];
        if (c != '\\') {
          out += c;
          continue;
        }
        if (pos >= text.size()) {
          fail("bad escape");
        }
        char e = text[pos++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': {
            unsigned code = std::stoul(text.substr(pos, 4), nullptr, 16);
            pos += 4;
            if (code >= 0xD800 && code <= 0xDBFF && text.compare(pos, 2, "\\u") == 0) {
              unsigned low = std::stoul(text.substr(pos + 2, 4), nullptr, 16);
              pos += 6;
              code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
            }
            appendUtf8(out, code);
            break;
          }
          default: out += e;
        }
      }
      if (pos >= text.size()) {
        fail("unterminated string");
      }
      pos++;
      return out;
    }

    static void appendUtf8(std::string& out, unsigned code) {
      if (code < 0x80) {
        out += static_cast<char>(code);
      } else if (code < 0x800) {
        out += static_cast<char>(0xC0 | (code >> 6));
        out += static_cast<char>(0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        out += static_cast<char>(0xE0 | (code >> 12));
        out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (code & 0x3F));
      } else {
        out += static_cast<char>(0xF0 | (code >> 18));
        out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (code & 0x3F));
      }
    }
  };

  static void writeString(std::string& out, const std::string& s) {
    out += '"';
    for (char c : s) {
      switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\t': out += "\\t"; break;
        case '\r': out += "\\r"; break;
        default:
          if (static_cast<unsigned char>(c) < 0x20) {
            char buf[8];
            std::snprintf(buf, sizeof(buf), "\\u%04x", c);
            out += buf;
          } else {
            out += c;
          }
      }
    }
    out += '"';
  }

  static void newline(std::string& out, int indent, int depth) {
    if (indent < 0) {
      return;
    }
    out += '\n';
    out.append(static_cast<size_t>(indent * depth), ' ');
  }

  void write(std::string& out, int indent, int depth) const {
    if (isNull()) {
      out += "null";
    } else if (isBool()) {
      out += asBool() ? "true" : "false";
    } else if (isNumber()) {
      double d = asNumber();
      if (!std::isfinite(d)) {
        out += "null";
      } else if (d == std::floor(d) && std::fabs(d) < 1e15) {
        out += std::to_string(static_cast<long long>(d));
      } else {
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.10g", d);
        out += buf;
      }
    } else if (isString()) {
      writeString(out, asString());
    } else if (isArray()) {
      const auto& array = asArray();
      out += '[';
      for (size_t i = 0; i < array.size(); i++) {
        if (i > 0) {
          out += ',';
        }
        newline(out, indent, depth + 1);
        array[i].write(out, indent, depth + 1);
      }
      if (!array.empty()) {
        newline(out, indent, depth);
      }
      out += ']';
    } else {
      const auto& object = asObject();
      out += '{';
      bool first = true;
      for (const auto& [key, value] : object) {
        if (!first) {
          out += ',';
        }
        first = false;
        newline(out, indent, depth + 1);
        writeString(out, key);
        out += indent < 0 ? ":" : ": ";
        value.write(out, indent, depth + 1);
      }
      if (!object.empty()) {
        newline(out, indent, depth);
      }
      out += '}';
    }
  }
};

} // namespace expoui::layout
