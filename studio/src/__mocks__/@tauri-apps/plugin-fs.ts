import { vi } from "vitest";

export const exists = vi.fn().mockResolvedValue(false);
export const readTextFile = vi.fn().mockResolvedValue("{}");
export const writeTextFile = vi.fn().mockResolvedValue(undefined);
export const readDir = vi.fn().mockResolvedValue([]);
export const remove = vi.fn().mockResolvedValue(undefined);
export const mkdir = vi.fn().mockResolvedValue(undefined);
export const stat = vi.fn().mockResolvedValue({ mtime: new Date(1_700_000_000_000), size: 0, isDirectory: false, isFile: true, isSymlink: false });
export const BaseDirectory = { Home: 0, Download: 7 };
