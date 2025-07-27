import { jest } from '@jest/globals';
import path from 'path';

// Mock the fs module
const mockFs = {
  mkdir: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
};

jest.unstable_mockModule('fs', () => ({
  promises: mockFs,
}));

// Import after mocking
const { PersistentStorage } = await import('../../src/infrastructure/persistent-storage.js');

describe('PersistentStorage', () => {
  let storage;
  let mockLogger;
  const testStorageDir = 'test-data';

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    // Reset fs mock implementations
    mockFs.mkdir.mockResolvedValue();
    mockFs.readFile.mockResolvedValue('{}');
    mockFs.writeFile.mockResolvedValue();
  });

  describe('constructor', () => {
    it('should initialize with default storage directory', () => {
      storage = new PersistentStorage(mockLogger);

      expect(storage.logger).toBe(mockLogger);
      expect(storage.storageDir).toBe('data');
      expect(storage.contentStatesFile).toBe(path.join('data', 'content-states.json'));
      expect(storage.fingerprintsFile).toBe(path.join('data', 'fingerprints.json'));
      expect(storage.seenUrlsFile).toBe(path.join('data', 'seen-urls.json'));
    });

    it('should initialize with custom storage directory', () => {
      storage = new PersistentStorage(mockLogger, testStorageDir);

      expect(storage.storageDir).toBe(testStorageDir);
      expect(storage.contentStatesFile).toBe(path.join(testStorageDir, 'content-states.json'));
      expect(storage.fingerprintsFile).toBe(path.join(testStorageDir, 'fingerprints.json'));
      expect(storage.seenUrlsFile).toBe(path.join(testStorageDir, 'seen-urls.json'));
    });

    it('should call ensureStorageDir during construction', () => {
      storage = new PersistentStorage(mockLogger, testStorageDir);

      expect(mockFs.mkdir).toHaveBeenCalledWith(testStorageDir, { recursive: true });
    });
  });

  describe('ensureStorageDir', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    it('should create storage directory successfully', async () => {
      mockFs.mkdir.mockResolvedValue();

      await storage.ensureStorageDir();

      expect(mockFs.mkdir).toHaveBeenCalledWith(testStorageDir, { recursive: true });
    });

    it('should handle directory creation failure', async () => {
      const error = new Error('Permission denied');
      mockFs.mkdir.mockRejectedValue(error);

      await expect(storage.ensureStorageDir()).rejects.toThrow('Permission denied');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create storage directory', {
        directory: testStorageDir,
        error: error.message,
      });
    });
  });

  describe('_readFile', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    it('should read and parse JSON file successfully', async () => {
      const testData = { key: 'value' };
      mockFs.readFile.mockResolvedValue(JSON.stringify(testData));

      const result = await storage._readFile('test.json');

      expect(result).toEqual(testData);
      expect(mockFs.readFile).toHaveBeenCalledWith('test.json', 'utf8');
    });

    it('should return empty object when file does not exist', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      mockFs.readFile.mockRejectedValue(error);

      const result = await storage._readFile('nonexistent.json');

      expect(result).toEqual({});
    });

    it('should handle JSON parse errors', async () => {
      mockFs.readFile.mockResolvedValue('invalid json');

      await expect(storage._readFile('invalid.json')).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to read or parse file: invalid.json',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('should handle other file system errors', async () => {
      const error = new Error('Permission denied');
      error.code = 'EACCES';
      mockFs.readFile.mockRejectedValue(error);

      await expect(storage._readFile('restricted.json')).rejects.toThrow('Permission denied');

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to read or parse file: restricted.json', {
        error: error.message,
      });
    });
  });

  describe('_writeFile', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    it('should write JSON data to file', async () => {
      const testData = { key: 'value', nested: { prop: 123 } };

      await storage._writeFile('test.json', testData);

      expect(mockFs.writeFile).toHaveBeenCalledWith('test.json', JSON.stringify(testData, null, 2), 'utf8');
    });

    it('should handle write errors', async () => {
      const error = new Error('Disk full');
      mockFs.writeFile.mockRejectedValue(error);

      await expect(storage._writeFile('test.json', {})).rejects.toThrow('Disk full');
    });
  });

  describe('Content State Management', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    describe('getAllContentStates', () => {
      it('should return all content states', async () => {
        const mockStates = { content1: { state: 'processed' } };
        mockFs.readFile.mockResolvedValue(JSON.stringify(mockStates));

        const result = await storage.getAllContentStates();

        expect(result).toEqual(mockStates);
        expect(mockFs.readFile).toHaveBeenCalledWith(storage.contentStatesFile, 'utf8');
      });

      it('should return empty object when file does not exist', async () => {
        const error = new Error('File not found');
        error.code = 'ENOENT';
        mockFs.readFile.mockRejectedValue(error);

        const result = await storage.getAllContentStates();

        expect(result).toEqual({});
      });
    });

    describe('getContentState', () => {
      it('should return specific content state', async () => {
        const mockStates = {
          content1: { state: 'processed', timestamp: '2023-01-01' },
          content2: { state: 'pending' },
        };
        mockFs.readFile.mockResolvedValue(JSON.stringify(mockStates));

        const result = await storage.getContentState('content1');

        expect(result).toEqual(mockStates.content1);
      });

      it('should return null for non-existent content', async () => {
        mockFs.readFile.mockResolvedValue('{}');

        const result = await storage.getContentState('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('storeContentState', () => {
      it('should store new content state', async () => {
        const existingStates = { content1: { state: 'old' } };
        const newState = { state: 'processed', timestamp: '2023-01-01' };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingStates));

        await storage.storeContentState('content2', newState);

        const expectedStates = {
          ...existingStates,
          content2: newState,
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.contentStatesFile,
          JSON.stringify(expectedStates, null, 2),
          'utf8'
        );
      });

      it('should update existing content state', async () => {
        const existingStates = { content1: { state: 'old' } };
        const updatedState = { state: 'updated', timestamp: '2023-01-02' };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingStates));

        await storage.storeContentState('content1', updatedState);

        const expectedStates = {
          content1: updatedState,
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.contentStatesFile,
          JSON.stringify(expectedStates, null, 2),
          'utf8'
        );
      });
    });

    describe('removeContentStates', () => {
      it('should remove specified content states', async () => {
        const existingStates = {
          content1: { state: 'processed' },
          content2: { state: 'pending' },
          content3: { state: 'finished' },
        };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingStates));

        await storage.removeContentStates(['content1', 'content3']);

        const expectedStates = {
          content2: { state: 'pending' },
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.contentStatesFile,
          JSON.stringify(expectedStates, null, 2),
          'utf8'
        );
      });

      it('should handle removal of non-existent content', async () => {
        const existingStates = { content1: { state: 'processed' } };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingStates));

        await storage.removeContentStates(['nonexistent', 'content1']);

        const expectedStates = {};

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.contentStatesFile,
          JSON.stringify(expectedStates, null, 2),
          'utf8'
        );
      });

      it('should not write file when no changes are made', async () => {
        const existingStates = { content1: { state: 'processed' } };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingStates));

        await storage.removeContentStates(['nonexistent1', 'nonexistent2']);

        expect(mockFs.writeFile).not.toHaveBeenCalled();
      });

      it('should handle empty content IDs array', async () => {
        const existingStates = { content1: { state: 'processed' } };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingStates));

        await storage.removeContentStates([]);

        expect(mockFs.writeFile).not.toHaveBeenCalled();
      });
    });
  });

  describe('Fingerprint Management', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    describe('hasFingerprint', () => {
      it('should return true for existing fingerprint', async () => {
        const fingerprints = { fp123: { content: 'test' } };
        mockFs.readFile.mockResolvedValue(JSON.stringify(fingerprints));

        const result = await storage.hasFingerprint('fp123');

        expect(result).toBe(true);
        expect(mockFs.readFile).toHaveBeenCalledWith(storage.fingerprintsFile, 'utf8');
      });

      it('should return false for non-existent fingerprint', async () => {
        mockFs.readFile.mockResolvedValue('{}');

        const result = await storage.hasFingerprint('nonexistent');

        expect(result).toBe(false);
      });

      it('should handle empty fingerprints file', async () => {
        const error = new Error('File not found');
        error.code = 'ENOENT';
        mockFs.readFile.mockRejectedValue(error);

        const result = await storage.hasFingerprint('fp123');

        expect(result).toBe(false);
      });
    });

    describe('storeFingerprint', () => {
      it('should store new fingerprint with metadata', async () => {
        const existingFingerprints = { fp1: { content: 'old' } };
        const metadata = { title: 'Test Video', url: 'https://example.com' };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingFingerprints));

        // Mock timestampUTC() to get predictable timestamp
        const mockDate = '2023-01-01T12:00:00.000Z';
        jest.spyOn(global, 'Date').mockImplementation(() => ({
          toISOString: () => mockDate,
        }));

        await storage.storeFingerprint('fp2', metadata);

        const expectedFingerprints = {
          ...existingFingerprints,
          fp2: {
            ...metadata,
            seenAt: mockDate,
          },
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.fingerprintsFile,
          JSON.stringify(expectedFingerprints, null, 2),
          'utf8'
        );

        global.Date.mockRestore();
      });

      it('should overwrite existing fingerprint', async () => {
        const existingFingerprints = { fp1: { content: 'old', seenAt: '2022-01-01' } };
        const newMetadata = { title: 'Updated Video', url: 'https://new.com' };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingFingerprints));

        const mockDate = '2023-01-01T12:00:00.000Z';
        jest.spyOn(global, 'Date').mockImplementation(() => ({
          toISOString: () => mockDate,
        }));

        await storage.storeFingerprint('fp1', newMetadata);

        const expectedFingerprints = {
          fp1: {
            ...newMetadata,
            seenAt: mockDate,
          },
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.fingerprintsFile,
          JSON.stringify(expectedFingerprints, null, 2),
          'utf8'
        );

        global.Date.mockRestore();
      });
    });
  });

  describe('URL Management', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    describe('hasUrl', () => {
      it('should return true for existing URL', async () => {
        const urls = { 'https://example.com': { seenAt: '2023-01-01' } };
        mockFs.readFile.mockResolvedValue(JSON.stringify(urls));

        const result = await storage.hasUrl('https://example.com');

        expect(result).toBe(true);
        expect(mockFs.readFile).toHaveBeenCalledWith(storage.seenUrlsFile, 'utf8');
      });

      it('should return false for non-existent URL', async () => {
        mockFs.readFile.mockResolvedValue('{}');

        const result = await storage.hasUrl('https://nonexistent.com');

        expect(result).toBe(false);
      });

      it('should handle empty URLs file', async () => {
        const error = new Error('File not found');
        error.code = 'ENOENT';
        mockFs.readFile.mockRejectedValue(error);

        const result = await storage.hasUrl('https://example.com');

        expect(result).toBe(false);
      });
    });

    describe('addUrl', () => {
      it('should add new URL', async () => {
        const existingUrls = { 'https://old.com': { seenAt: '2022-01-01' } };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingUrls));

        const mockDate = '2023-01-01T12:00:00.000Z';
        jest.spyOn(global, 'Date').mockImplementation(() => ({
          toISOString: () => mockDate,
        }));

        await storage.addUrl('https://new.com');

        const expectedUrls = {
          ...existingUrls,
          'https://new.com': { seenAt: mockDate },
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.seenUrlsFile,
          JSON.stringify(expectedUrls, null, 2),
          'utf8'
        );

        global.Date.mockRestore();
      });

      it('should not add existing URL again', async () => {
        const existingUrls = { 'https://existing.com': { seenAt: '2022-01-01' } };

        mockFs.readFile.mockResolvedValue(JSON.stringify(existingUrls));

        await storage.addUrl('https://existing.com');

        expect(mockFs.writeFile).not.toHaveBeenCalled();
      });

      it('should handle empty URLs file', async () => {
        const error = new Error('File not found');
        error.code = 'ENOENT';
        mockFs.readFile.mockRejectedValue(error);

        const mockDate = '2023-01-01T12:00:00.000Z';
        jest.spyOn(global, 'Date').mockImplementation(() => ({
          toISOString: () => mockDate,
        }));

        await storage.addUrl('https://first.com');

        const expectedUrls = {
          'https://first.com': { seenAt: mockDate },
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          storage.seenUrlsFile,
          JSON.stringify(expectedUrls, null, 2),
          'utf8'
        );

        global.Date.mockRestore();
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    it('should handle concurrent read operations', async () => {
      const testData = { key: 'value' };
      mockFs.readFile.mockResolvedValue(JSON.stringify(testData));

      const promises = [
        storage.getAllContentStates(),
        storage.hasFingerprint('fp1'),
        storage.hasUrl('https://example.com'),
      ];

      const results = await Promise.all(promises);

      expect(results[0]).toEqual(testData);
      expect(results[1]).toBe(false);
      expect(results[2]).toBe(false);
      expect(mockFs.readFile).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent write operations', async () => {
      mockFs.readFile.mockResolvedValue('{}');

      const promises = [
        storage.storeContentState('content1', { state: 'test1' }),
        storage.storeFingerprint('fp1', { title: 'Test' }),
        storage.addUrl('https://example.com'),
      ];

      await Promise.all(promises);

      expect(mockFs.writeFile).toHaveBeenCalledTimes(3);
    });

    it('should handle malformed JSON gracefully', async () => {
      mockFs.readFile.mockResolvedValue('{ invalid json }');

      await expect(storage.getAllContentStates()).rejects.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle null and undefined values', async () => {
      mockFs.readFile.mockResolvedValue('{}');

      await storage.storeContentState('test', null);
      await storage.storeFingerprint('fp1', undefined);

      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should handle very large data objects', async () => {
      const largeObject = {};
      for (let i = 0; i < 1000; i++) {
        largeObject[`key${i}`] = `value${i}`.repeat(100);
      }

      mockFs.readFile.mockResolvedValue('{}');

      await storage.storeContentState('large', largeObject);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        storage.contentStatesFile,
        expect.stringContaining('"large"'),
        'utf8'
      );
    });

    it('should handle special characters in keys and values', async () => {
      mockFs.readFile.mockResolvedValue('{}');

      const specialData = {
        'key with spaces': 'value with\nnewlines',
        'key"with"quotes': "value'with'quotes",
        'émojis🎉': '🚀test🌟',
      };

      await storage.storeContentState('special', specialData);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        storage.contentStatesFile,
        expect.stringContaining('émojis🎉'),
        'utf8'
      );
    });
  });

  describe('Integration Scenarios', () => {
    beforeEach(() => {
      storage = new PersistentStorage(mockLogger, testStorageDir);
    });

    it('should handle complete content lifecycle', async () => {
      // Start with empty storage
      mockFs.readFile.mockResolvedValue('{}');

      // Store content state
      await storage.storeContentState('video123', {
        state: 'processing',
        url: 'https://youtube.com/watch?v=123',
      });

      // Store fingerprint
      await storage.storeFingerprint('fp123', {
        title: 'Test Video',
        contentId: 'video123',
      });

      // Add URL
      await storage.addUrl('https://youtube.com/watch?v=123');

      // Verify all operations were called
      expect(mockFs.writeFile).toHaveBeenCalledTimes(3);
    });

    it('should handle cleanup operations', async () => {
      const initialStates = {
        old1: { state: 'processed', timestamp: '2022-01-01' },
        old2: { state: 'processed', timestamp: '2022-01-01' },
        current: { state: 'processing', timestamp: '2023-01-01' },
      };

      mockFs.readFile.mockResolvedValue(JSON.stringify(initialStates));

      // Remove old content states
      await storage.removeContentStates(['old1', 'old2']);

      const expectedStates = {
        current: { state: 'processing', timestamp: '2023-01-01' },
      };

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        storage.contentStatesFile,
        JSON.stringify(expectedStates, null, 2),
        'utf8'
      );
    });
  });
});
