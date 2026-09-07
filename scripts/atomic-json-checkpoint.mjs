import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Durably replaces a JSON checkpoint without ever truncating the last known
 * good file. The temporary file lives beside the target so rename remains an
 * atomic same-filesystem operation.
 */
export async function writeAtomicJsonCheckpoint(
  target,
  value,
  {
    openDirectory = open,
    platform = process.platform,
    renameFile = rename,
  } = {},
) {
  const directory = path.dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let handle;

  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temporary, target);
    await syncContainingDirectory(directory, { openDirectory, platform });
    await chmod(target, 0o600).catch(() => undefined);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncContainingDirectory(directory, { openDirectory, platform }) {
  let directoryHandle;
  try {
    directoryHandle = await openDirectory(directory, "r");
    await directoryHandle.sync();
  } catch (error) {
    await directoryHandle?.close().catch(() => undefined);
    if (platform === "win32" && isUnsupportedWindowsDirectorySync(error)) return;
    throw error;
  }

  if (platform === "win32") {
    await directoryHandle.close().catch(() => undefined);
    return;
  }
  await directoryHandle.close();
}

function isUnsupportedWindowsDirectorySync(error) {
  return error && [
    "EACCES",
    "EBADF",
    "EISDIR",
    "EINVAL",
    "ENOSYS",
    "ENOTSUP",
    "EPERM",
  ].includes(error.code);
}
