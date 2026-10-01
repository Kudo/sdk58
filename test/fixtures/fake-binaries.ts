/**
 * Files with the header of an executable (what scripts/release-host.ts
 * binaryArchs() reads), for --pack tests without real host builds.
 */

import fs from 'node:fs';

const MACHO_CPU = {x86_64: 0x01000007, arm64: 0x0100000c} as const;
type Arch = keyof typeof MACHO_CPU;

/** A Mach-O (one arch) or fat Mach-O (several archs). */
export function machO(file: string, archs: Arch[]): string {
  let head: Buffer;
  if (archs.length === 1) {
    head = Buffer.alloc(32);
    head.writeUInt32LE(0xfeedfacf, 0);
    head.writeUInt32LE(MACHO_CPU[archs[0]], 4);
  } else {
    head = Buffer.alloc(8 + 20 * archs.length);
    head.writeUInt32BE(0xcafebabe, 0);
    head.writeUInt32BE(archs.length, 4);
    archs.forEach((a, i) => head.writeUInt32BE(MACHO_CPU[a], 8 + 20 * i));
  }
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(`fake mach-o ${archs.join('+')}\n`)]));
  return file;
}

/** An ELF x86_64 header. */
export function elf(file: string): string {
  const head = Buffer.alloc(64);
  head.writeUInt32BE(0x7f454c46, 0);
  head[4] = 2; // 64-bit
  head[5] = 1; // little-endian
  head.writeUInt16LE(62, 18); // EM_X86_64
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from('fake elf\n')]));
  return file;
}

/** A PE x86_64 header (MZ stub, PE signature at 0x40). */
export function pe(file: string): string {
  const head = Buffer.alloc(0x80);
  head.write('MZ', 0, 'latin1');
  head.writeUInt32LE(0x40, 0x3c);
  head.write('PE\0\0', 0x40, 'latin1');
  head.writeUInt16LE(0x8664, 0x44); // IMAGE_FILE_MACHINE_AMD64
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from('fake pe\n')]));
  return file;
}
