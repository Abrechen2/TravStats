// Mock for webdav module
export function createClient(url: string, options?: any) {
  return {
    getDirectoryContents: jest.fn().mockResolvedValue([]),
    putFileContents: jest.fn().mockResolvedValue(undefined),
    getFileContents: jest.fn().mockResolvedValue(Buffer.from('')),
    createDirectory: jest.fn().mockResolvedValue(undefined),
  };
}





