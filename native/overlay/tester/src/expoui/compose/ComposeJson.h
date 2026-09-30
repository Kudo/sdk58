// A small JSON value with a parser and a writer. STL only. The Compose layout engine reads
// @expo/ui props and modifier params from it; the host converts `folly::dynamic` to it and the
// test runner parses JSON files.

#pragma once

#include <cctype>
#include <cmath>
#include <cstdio>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace expoui::compose {

class Json;
using JsonArray = std::vector<Json>;
using JsonObject = std::map<std::string, Json>;

class Json {
 public:
  Json() : v_(nullptr) {}
  Json(std::nullptr_t) : v_(nullptr) {}
  Json(bool b) : v_(b) {}
  Json(double d) : v_(d) {}
  Json(int i) : v_(static_cast<double>(i)) {}
  Json(const char* s) : v_(std::string(s)) {}
  Json(std::string s) : v_(std::move(s)) {}
  Json(JsonArray a) : v_(std::make_shared<JsonArray>(std::move(a))) {}
  Json(JsonObject o) : v_(std::make_shared<JsonObject>(std::move(o))) {}

  bool isNull() const { return std::holds_alternative<std::nullptr_t>(v_); }
  bool isBool() const { return std::holds_alternative<bool>(v_); }
  bool isNumber() const { return std::holds_alternative<double>(v_); }
  bool isString() const { return std::holds_alternative<std::string>(v_); }
  bool isArray() const { return std::holds_alternative<std::shared_ptr<JsonArray>>(v_); }
  bool isObject() const { return std::holds_alternative<std::shared_ptr<JsonObject>>(v_); }

  bool asBool(bool fallback = false) const { return isBool() ? std::get<bool>(v_) : fallback; }
  double asNumber(double fallback = 0) const { return isNumber() ? std::get<double>(v_) : fallback; }
  const std::string& asString() const {
    static const std::string empty;
    return isString() ? std::get<std::string>(v_) : empty;
  }
  const JsonArray& asArray() const {
    static const JsonArray empty;
    return isArray() ? *std::get<std::shared_ptr<JsonArray>>(v_) : empty;
  }
  const JsonObject& asObject() const {
    static const JsonObject empty;
    return isObject() ? *std::get<std::shared_ptr<JsonObject>>(v_) : empty;
  }

  /// Object member, or null.
  const Json& operator[](const std::string& key) const {
    static const Json null;
    if (!isObject()) {
      return null;
    }
    const auto& o = asObject();
    auto it = o.find(key);
    return it == o.end() ? null : it->second;
  }

  std::optional<double> number() const {
    return isNumber() ? std::optional<double>(asNumber()) : std::nullopt;
  }
  std::optional<std::string> string() const {
    return isString() ? std::optional<std::string>(asString()) : std::nullopt;
  }

  static Json parse(const std::string& text) {
    Parser p{text, 0};
    p.ws();
    Json v = p.value();
    p.ws();
    if (p.i != text.size()) {
      p.fail("trailing characters");
    }
    return v;
  }

  std::string dump(int indent = -1) const {
    std::string out;
    write(out, indent, 0);
    return out;
  }

 private:
  std::variant<std::nullptr_t, bool, double, std::string, std::shared_ptr<JsonArray>, std::shared_ptr<JsonObject>> v_;

  struct Parser {
    const std::string& s;
    size_t i;

    [[noreturn]] void fail(const char* what) const {
      throw std::runtime_error(std::string("JSON: ") + what + " at offset " + std::to_string(i));
    }
    void ws() {
      while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) {
        i++;
      }
    }
    bool lit(const char* word) {
      size_t n = std::char_traits<char>::length(word);
      if (s.compare(i, n, word) == 0) {
        i += n;
        return true;
      }
      return false;
    }
    Json value() {
      if (i >= s.size()) {
        fail("unexpected end");
      }
      char c = s[i];
      if (c == '{') {
        i++;
        JsonObject o;
        ws();
        if (i < s.size() && s[i] == '}') {
          i++;
          return o;
        }
        while (true) {
          ws();
          if (i >= s.size() || s[i] != '"') {
            fail("expected key");
          }
          std::string key = str();
          ws();
          if (i >= s.size() || s[i] != ':') {
            fail("expected ':'");
          }
          i++;
          ws();
          o[key] = value();
          ws();
          if (i < s.size() && s[i] == ',') {
            i++;
            continue;
          }
          if (i < s.size() && s[i] == '}') {
            i++;
            return o;
          }
          fail("expected ',' or '}'");
        }
      }
      if (c == '[') {
        i++;
        JsonArray a;
        ws();
        if (i < s.size() && s[i] == ']') {
          i++;
          return a;
        }
        while (true) {
          ws();
          a.push_back(value());
          ws();
          if (i < s.size() && s[i] == ',') {
            i++;
            continue;
          }
          if (i < s.size() && s[i] == ']') {
            i++;
            return a;
          }
          fail("expected ',' or ']'");
        }
      }
      if (c == '"') {
        return str();
      }
      if (lit("true")) {
        return true;
      }
      if (lit("false")) {
        return false;
      }
      if (lit("null")) {
        return nullptr;
      }
      size_t start = i;
      while (i < s.size() && (std::isdigit(static_cast<unsigned char>(s[i])) || s[i] == '-' || s[i] == '+' ||
                              s[i] == '.' || s[i] == 'e' || s[i] == 'E')) {
        i++;
      }
      if (start == i) {
        fail("unexpected character");
      }
      return std::stod(s.substr(start, i - start));
    }
    static void utf8(std::string& out, unsigned cp) {
      if (cp < 0x80) {
        out += static_cast<char>(cp);
      } else if (cp < 0x800) {
        out += static_cast<char>(0xC0 | (cp >> 6));
        out += static_cast<char>(0x80 | (cp & 0x3F));
      } else if (cp < 0x10000) {
        out += static_cast<char>(0xE0 | (cp >> 12));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
      } else {
        out += static_cast<char>(0xF0 | (cp >> 18));
        out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
        out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out += static_cast<char>(0x80 | (cp & 0x3F));
      }
    }
    unsigned hex4() {
      if (i + 4 > s.size()) {
        fail("bad \\u escape");
      }
      unsigned v = std::stoul(s.substr(i, 4), nullptr, 16);
      i += 4;
      return v;
    }
    std::string str() {
      i++;  // opening quote
      std::string out;
      while (i < s.size() && s[i] != '"') {
        char c = s[i++];
        if (c != '\\') {
          out += c;
          continue;
        }
        if (i >= s.size()) {
          fail("bad escape");
        }
        char e = s[i++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'u': {
            unsigned cp = hex4();
            if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
              i += 2;
              unsigned lo = hex4();
              cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            }
            utf8(out, cp);
            break;
          }
          default: out += e;
        }
      }
      if (i >= s.size()) {
        fail("unterminated string");
      }
      i++;
      return out;
    }
  };

  static void quote(std::string& out, const std::string& s) {
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
            std::snprintf(buf, sizeof buf, "\\u%04x", c);
            out += buf;
          } else {
            out += c;
          }
      }
    }
    out += '"';
  }

  void write(std::string& out, int indent, int depth) const {
    auto newline = [&](int d) {
      if (indent >= 0) {
        out += '\n';
        out.append(static_cast<size_t>(indent * d), ' ');
      }
    };
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
        std::snprintf(buf, sizeof buf, "%.10g", d);
        out += buf;
      }
    } else if (isString()) {
      quote(out, asString());
    } else if (isArray()) {
      const auto& a = asArray();
      out += '[';
      for (size_t k = 0; k < a.size(); k++) {
        if (k) {
          out += ',';
        }
        newline(depth + 1);
        a[k].write(out, indent, depth + 1);
      }
      if (!a.empty()) {
        newline(depth);
      }
      out += ']';
    } else {
      const auto& o = asObject();
      out += '{';
      bool first = true;
      for (const auto& [k, v] : o) {
        if (!first) {
          out += ',';
        }
        first = false;
        newline(depth + 1);
        quote(out, k);
        out += indent >= 0 ? ": " : ":";
        v.write(out, indent, depth + 1);
      }
      if (!o.empty()) {
        newline(depth);
      }
      out += '}';
    }
  }
};

}  // namespace expoui::compose
