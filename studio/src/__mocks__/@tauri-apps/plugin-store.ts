import { vi } from "vitest";

const storeMock = {
  get: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  save: vi.fn().mockResolvedValue(undefined),
};

export const load = vi.fn().mockResolvedValue(storeMock);
export const Store = vi.fn().mockImplementation(() => storeMock);
