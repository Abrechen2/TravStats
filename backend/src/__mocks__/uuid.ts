/**
 * Mock for uuid library to avoid ESM issues in Jest
 */

let counter = 0;

export function v4(): string {
  // Generate a simple mock UUID for testing
  counter++;
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
}

export function v1(): string {
  counter++;
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
}

export function v3(): string {
  counter++;
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
}

export function v5(): string {
  counter++;
  return `00000000-0000-0000-0000-${String(counter).padStart(12, '0')}`;
}

// Default export
export default {
  v1,
  v3,
  v4,
  v5,
};
