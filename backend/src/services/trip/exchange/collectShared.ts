import path from "path";

export const isoDay = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export const extensionOf = (name: string, fallback: string): string => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : fallback;
};
