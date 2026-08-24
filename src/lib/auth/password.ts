import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAX_MEMORY = 32 * 1024 * 1024;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = (await scryptPassword(password, salt)).toString("base64url");

  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export async function verifyPassword(password: string, storedHash: string) {
  const parts = storedHash.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  try {
    const [, n, r, p, salt, hash] = parts;
    const expected = Buffer.from(hash, "base64url");
    const actual = await scryptPassword(password, salt, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function scryptPassword(
  password: string,
  salt: string,
  params: { N: number; r: number; p: number } = {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        ...params,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}
