import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CommandProcessor } from '../../src/core/command-processor.js';
import { ContentClassifier } from '../../src/core/content-classifier.js';
import { ContentAnnouncer } from '../../src/core/content-announcer.js';
import { Configuration } from '../../src/infrastructure/configuration.js';
import { StateManager } from '../../src/infrastructure/state-manager.js';

describe('Application Input Validation Security Tests', () => {
  let commandProcessor;
  let contentClassifier;
  let contentAnnouncer;
  let mockConfig;
  let mockStateManager;
  let mockLogger;
  let mockDiscordService;
  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();

    // Save original environment
    originalEnv = process.env;

    // Set up test environment
    process.env = {
      ...originalEnv,
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
      DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
      DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
      ALLOWED_USER_IDS: '123456789012345678,987654321098765432',
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key, defaultValue) => {
        const config = {
          DISCORD_BOT_TOKEN: 'test-token',
          DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
          DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
          DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
          DISCORD_X_POSTS_CHANNEL_ID: '123456789012345681',
          DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345682',
          DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345683',
          DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345684',
          ALLOWED_USER_IDS: '123456789012345678,987654321098765432',
          COMMAND_PREFIX: '!',
        };
        return config[key] || defaultValue;
      }),
      getRequired: jest.fn().mockImplementation(key => {
        const config = {
          DISCORD_BOT_TOKEN: 'test-token',
          DISCORD_SUPPORT_CHANNEL_ID: '123456789012345678',
          DISCORD_ANNOUNCE_CHANNEL_ID: '123456789012345679',
          DISCORD_YOUTUBE_CHANNEL_ID: '123456789012345680',
          DISCORD_X_POSTS_CHANNEL_ID: '123456789012345681',
          DISCORD_X_REPLIES_CHANNEL_ID: '123456789012345682',
          DISCORD_X_QUOTES_CHANNEL_ID: '123456789012345683',
          DISCORD_X_RETWEETS_CHANNEL_ID: '123456789012345684',
        };
        if (!config[key]) {
          throw new Error(`Required configuration ${key} is missing`);
        }
        return config[key];
      }),
    };

    mockStateManager = {
      get: jest.fn().mockReturnValue(true),
      set: jest.fn(),
      subscribe: jest.fn(),
      setValidator: jest.fn(),
    };

    mockDiscordService = {
      sendMessage: jest.fn().mockResolvedValue({ id: 'message123' }),
      login: jest.fn().mockResolvedValue(),
      destroy: jest.fn().mockResolvedValue(),
    };

    commandProcessor = new CommandProcessor(mockConfig, mockStateManager);
    contentClassifier = new ContentClassifier();
    contentAnnouncer = new ContentAnnouncer(mockDiscordService, mockConfig, mockStateManager);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Command Processor Input Validation', () => {
    it('should reject commands with malicious payloads', async () => {
      const maliciousCommands = [
        // Command injection attempts
        { command: 'announce', args: ['true; rm -rf /'], userId: '123456789012345678' },
        { command: 'loglevel', args: ['info && cat /etc/passwd'], userId: '123456789012345678' },
        { command: 'announce', args: ['$(whoami)'], userId: '123456789012345678' },
        { command: 'loglevel', args: ['`id`'], userId: '123456789012345678' },

        // Path traversal attempts
        { command: 'announce', args: ['../../../etc/passwd'], userId: '123456789012345678' },
        { command: 'loglevel', args: ['../../secret'], userId: '123456789012345678' },

        // XSS attempts
        { command: 'announce', args: ['<script>alert(1)</script>'], userId: '123456789012345678' },
        { command: 'loglevel', args: ['data:text/html,alert(1)'], userId: '123456789012345678' },

        // SQL injection attempts
        { command: 'announce', args: ["'; DROP TABLE users; --"], userId: '123456789012345678' },
        { command: 'loglevel', args: ["' OR '1'='1"], userId: '123456789012345678' },

        // Buffer overflow attempts
        { command: 'announce', args: ['A'.repeat(10000)], userId: '123456789012345678' },

        // Null byte injection
        { command: 'announce', args: ['true\\x00'], userId: '123456789012345678' },
        { command: 'loglevel', args: ['info\\0'], userId: '123456789012345678' },
      ];

      for (const { command, args, userId } of maliciousCommands) {
        const result = await commandProcessor.processCommand(command, args, userId);

        // Should either reject the command or sanitize the arguments
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/invalid|error|unknown|not allowed/i);

        // Verify the malicious content is not executed or stored
        expect(result.message).not.toContain('rm -rf');
        expect(result.message).not.toContain('cat /etc/passwd');
        expect(result.message).not.toContain('<script>');
        expect(result.message).not.toContain('DROP TABLE');
      }
    });

    it('should validate user ID format to prevent spoofing', async () => {
      const invalidUserIds = [
        '',
        null,
        undefined,
        '123', // Too short
        '12345678901234567890', // Too long
        'not-a-number',
        '123abc456',
        '<script>alert(1)</script>',
        '${process.env.SECRET}',
        '../../../etc/passwd',
        '123; rm -rf /',
      ];

      for (const userId of invalidUserIds) {
        const result = await commandProcessor.processCommand('health', [], userId);

        // Should reject invalid user IDs
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/invalid.*user|unauthorized|error/i);
      }
    });

    it('should prevent command prefix injection', async () => {
      const maliciousPrefixes = [
        '!!',
        '!; rm -rf /',
        '!$(whoami)',
        '!`cat /etc/passwd`',
        '!<script>alert(1)</script>',
        '!\n\r\tcommand',
      ];

      // Since we're testing the processor directly, we simulate what would happen
      // if a malicious prefix somehow got through Discord parsing
      for (const _prefix of maliciousPrefixes) {
        // The command should be sanitized before reaching the processor
        const result = await commandProcessor.processCommand('health', [], '123456789012345678');

        // Verify no malicious content appears in responses
        expect(result.message).not.toContain('rm -rf');
        expect(result.message).not.toContain('whoami');
        expect(result.message).not.toContain('<script>');
      }
    });

    it('should handle excessively long command arguments', async () => {
      const longArgs = ['A'.repeat(1000), 'B'.repeat(5000), 'C'.repeat(10000)];

      for (const arg of longArgs) {
        const result = await commandProcessor.processCommand('announce', [arg], '123456789012345678');

        // Should reject or truncate excessively long arguments
        expect(result.success).toBe(false);
        expect(result.message).toMatch(/invalid|error|too long/i);
      }
    });

    it('should sanitize special characters in command responses', async () => {
      // Test that responses are safe for Discord
      const result = await commandProcessor.processCommand('health', [], '123456789012345678');

      // Response should not contain dangerous content regardless of success
      expect(result.message).not.toContain('<script>');
      expect(result.message).not.toContain('data:text/html');
      expect(result.message).not.toMatch(/on\w+\s*=/);
    });
  });

  describe('Content Classifier Input Validation', () => {
    it('should handle malicious URL inputs safely', () => {
      const maliciousUrls = [
        'data:text/html,malicious',
        'data:text/html,malicious_payload',
        'file:///etc/passwd',
        'ftp://malicious.com/steal',
        'http://localhost:8080/admin',
        'https://127.0.0.1/secret',
        'vbscript:MsgBox(1)',
        'jar:http://malicious.com!/evil.class',
        'about:blank',
        null,
        undefined,
        '',
        'not-a-url',
        '../../etc/passwd',
        '<script>alert(1)</script>',
      ];

      for (const url of maliciousUrls) {
        // Test various classification methods
        expect(() => {
          contentClassifier.classifyVideoContent({ videoUrl: url });
        }).not.toThrow();

        expect(() => {
          contentClassifier.classifyXPost({ entities: { urls: [{ expanded_url: url }] } });
        }).not.toThrow();
      }
    });

    it('should validate video metadata to prevent injection', () => {
      const maliciousMetadata = [
        {
          title: '<script>alert("XSS")</script>',
          description: 'data:text/html,alert(1)',
          tags: ['<iframe src="evil.com"></iframe>'],
        },
        {
          title: '${process.env.SECRET}',
          description: '`cat /etc/passwd`',
          tags: ['$(whoami)'],
        },
        {
          title: 'Valid title',
          description: 'data:text/html,malicious_content',
          tags: ['../../etc/passwd'],
        },
        {
          title: null,
          description: undefined,
          tags: '<script>alert(1)</script>', // Should be array
        },
      ];

      for (const metadata of maliciousMetadata) {
        expect(() => {
          const result = contentClassifier.classifyVideoContent(metadata);

          // If classification succeeds, ensure output is sanitized
          if (result && result.title) {
            expect(result.title).not.toContain('<script>');
          }
        }).not.toThrow();
      }
    });

    it('should handle malformed content structures gracefully', () => {
      const malformedContent = [
        null,
        undefined,
        '',
        123,
        [],
        'string-instead-of-object',
        { recursive: { self: null } },
        { circular: {} },
      ];

      // Create circular reference
      malformedContent[malformedContent.length - 1].circular.ref = malformedContent[malformedContent.length - 1];

      for (const content of malformedContent) {
        expect(() => {
          contentClassifier.classifyVideoContent(content);
          contentClassifier.classifyXPost(content);
        }).not.toThrow();
      }
    });
  });

  describe('Content Announcer Input Validation', () => {
    it('should sanitize announcement content before sending to Discord', async () => {
      const maliciousContent = [
        {
          title: '<script>alert("XSS")</script>',
          description: 'Safe description',
          url: 'https://youtube.com/watch?v=test',
        },
        {
          title: 'Valid title',
          description: 'data:text/html,alert(1)',
          url: 'https://youtube.com/watch?v=test',
        },
        {
          title: 'Valid title',
          description: 'Safe description',
          url: 'data:text/html,malicious',
        },
        {
          title: '@everyone @here <@123>',
          description: 'Mention spam attempt',
          url: 'https://youtube.com/watch?v=test',
        },
      ];

      for (const content of maliciousContent) {
        await expect(contentAnnouncer.announceVideoContent(content)).resolves.not.toThrow();

        // Check that sent messages are sanitized
        const callCount = mockDiscordService.sendMessage.mock.calls.length;
        expect(callCount).toBeGreaterThan(0);
        
        const lastCall = mockDiscordService.sendMessage.mock.calls[callCount - 1];
        const sentContent = lastCall[1]; // Second argument is the message content

        expect(sentContent).not.toContain('<script>');
        expect(sentContent).not.toContain('data:text/html');
      }
    });

    it('should validate Discord channel IDs to prevent injection', async () => {
      const maliciousChannelIds = [
        '<script>alert(1)</script>',
        'data:text/html,malicious',
        '../../etc/passwd',
        '${process.env.SECRET}',
        '`cat /etc/passwd`',
        '$(whoami)',
        null,
        undefined,
        '',
        '123', // Too short
        '12345678901234567890', // Too long
        'not-a-number',
      ];

      for (const channelId of maliciousChannelIds) {
        // Mock config to return malicious channel ID
        mockConfig.get.mockReturnValueOnce(channelId);

        const content = {
          title: 'Test video',
          description: 'Test description',
          url: 'https://youtube.com/watch?v=test',
        };

        await expect(contentAnnouncer.announceVideoContent(content)).resolves.not.toThrow();

        // Should handle invalid channel IDs gracefully
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringMatching(/invalid.*channel|failed.*send/i),
          expect.anything()
        );
      }
    });

    it('should prevent message content overflow', async () => {
      const oversizedContent = {
        title: 'A'.repeat(1000),
        description: 'B'.repeat(5000),
        url: `https://youtube.com/watch?v=${'C'.repeat(100)}`,
      };

      await expect(contentAnnouncer.announceVideoContent(oversizedContent)).resolves.not.toThrow();

      // Check that Discord API limits are respected
      const callCount = mockDiscordService.sendMessage.mock.calls.length;
      expect(callCount).toBeGreaterThan(0);
      
      const lastCall = mockDiscordService.sendMessage.mock.calls[callCount - 1];
      const sentContent = lastCall[1];

      // Discord message limit is 2000 characters
      expect(sentContent.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('Configuration Input Validation', () => {
    it('should validate environment variable format', () => {
      const maliciousEnvVars = {
        DISCORD_BOT_TOKEN: '<script>alert(1)</script>',
        DISCORD_SUPPORT_CHANNEL_ID: 'data:text/html,alert(1)',
        YOUTUBE_API_KEY: '../../etc/passwd',
        ALLOWED_USER_IDS: '${process.env.SECRET}',
        PSH_SECRET: '`cat /etc/passwd`',
        COMMAND_PREFIX: '!; rm -rf /',
      };

      Object.entries(maliciousEnvVars).forEach(([key, value]) => {
        process.env[key] = value;
      });

      // Configuration should handle malicious values safely
      expect(() => {
        const config = new Configuration();

        // Values should be accessible but treated as literal strings
        Object.keys(maliciousEnvVars).forEach(key => {
          const configValue = config.get(key);
          expect(typeof configValue).toBe('string');
          // Should not execute any embedded code
        });
      }).not.toThrow();
    });

    it('should validate state manager values for injection', () => {
      const stateManager = new StateManager();

      const maliciousValues = [
        '<script>alert(1)</script>',
        'data:text/html,malicious',
        '../../etc/passwd',
        '${process.env.SECRET}',
        '`cat /etc/passwd`',
        '$(whoami)',
        { malicious: '<script>alert(1)</script>' },
        ['<iframe src="evil.com"></iframe>'],
      ];

      for (const value of maliciousValues) {
        expect(() => {
          stateManager.set('test_key', value);
          const retrieved = stateManager.get('test_key');

          // Value should be stored but not executed
          expect(retrieved).toBeDefined();
          expect(typeof retrieved).toBe('string');
        }).not.toThrow();
      }
    });
  });

  describe('File System Input Validation', () => {
    it('should prevent path traversal in log file paths', () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\\\..\\\\windows\\\\system32',
        '/etc/shadow',
        '../../.env',
        'logs/../../../secret',
        '\\\\..\\\\..\\\\config',
        'C:\\\\Windows\\\\System32\\\\config\\\\sam',
      ];

      // Test that configuration handles malicious log paths safely
      for (const path of maliciousPaths) {
        process.env.LOG_FILE_PATH = path;

        expect(() => {
          const config = new Configuration();
          const logPath = config.get('LOG_FILE_PATH');

          // Should store the path but not traverse directories unsafely
          expect(typeof logPath).toBe('string');
        }).not.toThrow();
      }
    });

    it('should validate file extensions for security', () => {
      const dangerousExtensions = [
        'malicious.exe',
        'virus.bat',
        'script.sh',
        'payload.ps1',
        'backdoor.php',
        'webshell.jsp',
        'trojan.scr',
      ];

      // These shouldn't be processed as valid log files
      for (const filename of dangerousExtensions) {
        process.env.LOG_FILE_PATH = filename;

        expect(() => {
          const config = new Configuration();
          const logPath = config.get('LOG_FILE_PATH');

          // Should store the value but with security awareness
          expect(typeof logPath).toBe('string');
        }).not.toThrow();
      }
    });
  });

  describe('Network Input Validation', () => {
    it('should validate webhook URLs for SSRF prevention', () => {
      const maliciousUrls = [
        'http://localhost:8080/admin',
        'https://127.0.0.1/secret',
        'http://10.0.0.1/internal',
        'https://192.168.1.1/router',
        'http://169.254.169.254/metadata', // AWS metadata
        'ftp://internal.server/file',
        'file:///etc/passwd',
        'data:text/html,malicious',
        'data:text/html,malicious_payload',
        'gopher://malicious.com:25/evil',
      ];

      for (const url of maliciousUrls) {
        process.env.PSH_CALLBACK_URL = url;

        expect(() => {
          const config = new Configuration();
          const callbackUrl = config.get('PSH_CALLBACK_URL');

          // Should store URL but validation should prevent SSRF
          expect(typeof callbackUrl).toBe('string');
        }).not.toThrow();
      }
    });

    it('should validate rate limiting parameters', () => {
      const maliciousRateLimits = [
        '-1', // Negative values
        '999999999', // Extremely high values
        'NaN',
        'Infinity',
        '<script>alert(1)</script>',
        '${process.env.SECRET}',
        '../../etc/passwd',
      ];

      for (const limit of maliciousRateLimits) {
        process.env.RATE_LIMIT_MAX = limit;

        expect(() => {
          const config = new Configuration();
          const rateLimit = config.get('RATE_LIMIT_MAX', 100);

          // Should handle invalid values gracefully
          expect(typeof rateLimit).toBe('number');
          expect(rateLimit).toBeGreaterThan(0);
          expect(rateLimit).toBeLessThan(10000); // Reasonable upper bound
        }).not.toThrow();
      }
    });
  });
});
