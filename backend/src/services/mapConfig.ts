/** Public style URLs, never credentials. Tiles are fetched directly by clients. */
export function getMapConfig(env: NodeJS.ProcessEnv = process.env) {
  const defaults = { standard: "liberty", light: "positron", dark: "dark", voyager: "bright" };
  const styles = Object.fromEntries(
    Object.entries(defaults).map(([id, style]) => {
      const name = `MAP_STYLE_${id.toUpperCase()}_URL`;
      const value = env[name] || `https://tiles.openfreemap.org/styles/${style}`;
      try {
        const url = new URL(value);
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.hash ||
          url.search ||
          /\s/.test(value)
        )
          throw new Error();
      } catch {
        throw new Error(
          `${name} must be a public HTTPS style URL without credentials, query or fragment`
        );
      }
      return [id, value];
    })
  );
  return { version: 1 as const, styles };
}
