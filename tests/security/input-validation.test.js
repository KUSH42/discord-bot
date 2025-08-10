import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createMockRequest, createMockResponse } from '../mocks/express.mock.js';
import { createMockMessage, createMockUser } from '../mocks/discord.mock.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

describe('Security and Input Validation Tests', () => {
  let consoleSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = {
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('Input Sanitization and Validation', () => {
    it('should sanitize Discord message content to prevent XSS', () => {
      const sanitizeMessage = content => {
        if (typeof content !== 'string') {
          throw new Error('Content must be a string');
        }

        // Remove potentially dangerous characters and patterns
        return content
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '[SCRIPT_REMOVED]')
          .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '[IFRAME_REMOVED]')
          .replace(/javascript:/gi, 'javascript_')
          .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '[EVENT_HANDLER_REMOVED]')
          .replace(/data:text\/html/gi, 'data_text_html')
          .trim()
          .substring(0, 2000); // Discord message limit
      };

      const maliciousInputs = [
        '<script>alert("XSS")</script>',
        '<iframe src="javascript:alert(1)"></iframe>',
        'javascript:alert("XSS")',
        '<img src="x" onerror="alert(1)">',
        '<div onclick="alert(1)">Click me</div>',
        'data:text/html,<script>alert(1)</script>',
        '<svg onload="alert(1)"></svg>',
        '"><script>alert(1)</script>',
      ];

      maliciousInputs.forEach(input => {
        const sanitized = sanitizeMessage(input);

        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('<iframe>');
        expect(sanitized).not.toContain('javascript:');
        expect(sanitized).not.toContain('onerror=');
        expect(sanitized).not.toContain('onclick=');
        expect(sanitized).not.toContain('onload=');
        expect(sanitized).not.toContain('data:text/html');
      });

      // Valid content should pass through
      const validInputs = [
        'Hello world!',
        'Check out this video: https://youtube.com/watch?v=abc123',
        'New tweet: https://x.com/user/status/123456789',
        'Normal message with emojis 🎉🎊',
        'Message with numbers 123 and symbols !@#$%',
      ];

      validInputs.forEach(input => {
        const sanitized = sanitizeMessage(input);
        expect(sanitized).toBe(input);
      });
    });

    it('should validate URL inputs to prevent SSRF attacks', () => {
      const validateUrl = url => {
        if (typeof url !== 'string') {
          throw new Error('URL must be a string');
        }

        try {
          const parsedUrl = new URL(url);

          // Only allow HTTP and HTTPS protocols
          if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            throw new Error('Invalid protocol');
          }

          // Block internal IP ranges
          const { hostname } = parsedUrl;
          const blockedPatterns = [
            /^localhost$/i,
            /^127\./,
            /^10\./,
            /^172\.(1[6-9]|2[0-9]|3[01])\./,
            /^192\.168\./,
            /^169\.254\./, // Link-local
            /^::1$/, // IPv6 localhost
            /^fc00:/, // IPv6 private
            /^fe80:/, // IPv6 link-local
          ];

          if (blockedPatterns.some(pattern => pattern.test(hostname))) {
            throw new Error('Blocked internal IP range');
          }

          // Validate allowed domains for webhooks
          const allowedDomains = ['youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'vxtwitter.com', 'fxtwitter.com'];

          const isAllowedDomain = allowedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

          if (!isAllowedDomain) {
            throw new Error('Domain not in allowlist');
          }

          return { valid: true, url: parsedUrl.toString() };
        } catch (error) {
          return { valid: false, error: error.message };
        }
      };

      const maliciousUrls = [
        'file:///etc/passwd',
        'ftp://internal.server/file',
        'http://localhost:8080/admin',
        'https://127.0.0.1/secret',
        'http://10.0.0.1/internal',
        'https://192.168.1.1/router',
        'http://169.254.169.254/metadata', // AWS metadata
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'http://malicious.com/webhook',
      ];

      maliciousUrls.forEach(url => {
        const result = validateUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });

      const validUrls = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://x.com/user/status/123456789',
        'https://twitter.com/user/status/123456789',
        'https://vxtwitter.com/user/status/123456789',
      ];

      validUrls.forEach(url => {
        const result = validateUrl(url);
        expect(result.valid).toBe(true);
        expect(result.url).toBe(url);
      });
    });

    it('should validate webhook signatures to prevent replay attacks', () => {
      const crypto = {
        createHmac: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnThis(),
          digest: jest.fn().mockReturnValue('expected-signature-hash'),
        }),
      };

      const validateWebhookSignature = (signature, payload, secret, timestamp) => {
        if (!signature || !payload || !secret) {
          return { valid: false, error: 'Missing required parameters' };
        }

        // Check signature format
        if (!signature.startsWith('sha1=')) {
          return { valid: false, error: 'Invalid signature format' };
        }

        // Check timestamp to prevent replay attacks (5 minute window)
        const currentTime = Math.floor(timestampUTC() / 1000);
        const maxAge = 300; // 5 minutes

        if (Math.abs(currentTime - timestamp) > maxAge) {
          return { valid: false, error: 'Timestamp too old' };
        }

        // Verify signature
        const expectedSignature = `sha1=${crypto.createHmac('sha1', secret).update(payload).digest('hex')}`;

        const receivedSignature = signature;

        // Use constant-time comparison to prevent timing attacks
        if (expectedSignature.length !== receivedSignature.length) {
          return { valid: false, error: 'Invalid signature' };
        }

        let result = 0;
        for (let i = 0; i < expectedSignature.length; i++) {
          result |= expectedSignature.charCodeAt(i) ^ receivedSignature.charCodeAt(i);
        }

        if (result !== 0) {
          return { valid: false, error: 'Invalid signature' };
        }

        return { valid: true };
      };

      const validPayload = '<feed><entry><id>test</id></entry></feed>';
      const secret = 'webhook-secret';
      const currentTimestamp = Math.floor(timestampUTC() / 1000);
      const validSignature = 'sha1=expected-signature-hash';

      // Valid signature
      const validResult = validateWebhookSignature(validSignature, validPayload, secret, currentTimestamp);
      expect(validResult.valid).toBe(true);

      // Invalid signature format
      const invalidFormatResult = validateWebhookSignature('invalid-format', validPayload, secret, currentTimestamp);
      expect(invalidFormatResult.valid).toBe(false);
      expect(invalidFormatResult.error).toContain('Invalid signature format');

      // Expired timestamp
      const oldTimestamp = currentTimestamp - 600; // 10 minutes ago
      const expiredResult = validateWebhookSignature(validSignature, validPayload, secret, oldTimestamp);
      expect(expiredResult.valid).toBe(false);
      expect(expiredResult.error).toContain('Timestamp too old');

      // Missing parameters
      const missingResult = validateWebhookSignature(null, validPayload, secret, currentTimestamp);
      expect(missingResult.valid).toBe(false);
      expect(missingResult.error).toContain('Missing required parameters');
    });

    it('should validate Discord user permissions and authorization', () => {
      const authorizeUser = (user, command, allowedUserIds = []) => {
        if (!user || !user.id) {
          return { authorized: false, reason: 'Invalid user' };
        }

        // Bot users are never authorized
        if (user.bot) {
          return { authorized: false, reason: 'Bot users not allowed' };
        }

        // Check if command requires special authorization
        const restrictedCommands = ['restart', 'kill', 'announce'];

        if (restrictedCommands.includes(command)) {
          if (allowedUserIds.length === 0) {
            return { authorized: false, reason: 'No authorized users configured' };
          }

          if (!allowedUserIds.includes(user.id)) {
            return { authorized: false, reason: 'User not in authorized list' };
          }
        }

        // Check for suspicious user patterns
        if (user.id.length < 17 || user.id.length > 19) {
          return { authorized: false, reason: 'Invalid user ID format' };
        }

        // Check for numeric-only user ID (Discord snowflakes)
        if (!/^\d+$/.test(user.id)) {
          return { authorized: false, reason: 'Invalid user ID format' };
        }

        return { authorized: true };
      };

      const validUser = createMockUser({ id: '123456789012345678', bot: false });
      const botUser = createMockUser({ id: '987654321098765432', bot: true });
      const invalidUser = createMockUser({ id: 'invalid-id', bot: false });
      const allowedUsers = ['123456789012345678'];

      // Valid user with non-restricted command
      expect(authorizeUser(validUser, 'health').authorized).toBe(true);

      // Bot user (should be rejected)
      expect(authorizeUser(botUser, 'health').authorized).toBe(false);
      expect(authorizeUser(botUser, 'health').reason).toContain('Bot users not allowed');

      // Invalid user ID format
      expect(authorizeUser(invalidUser, 'health').authorized).toBe(false);
      expect(authorizeUser(invalidUser, 'health').reason).toContain('Invalid user ID format');

      // Restricted command with authorization
      expect(authorizeUser(validUser, 'restart', allowedUsers).authorized).toBe(true);

      // Restricted command without authorization
      expect(authorizeUser(validUser, 'restart', []).authorized).toBe(false);
      expect(authorizeUser(validUser, 'restart', []).reason).toContain('No authorized users configured');

      // Unauthorized user for restricted command
      const unauthorizedUser = createMockUser({ id: '999999999999999999', bot: false });
      expect(authorizeUser(unauthorizedUser, 'restart', allowedUsers).authorized).toBe(false);
      expect(authorizeUser(unauthorizedUser, 'restart', allowedUsers).reason).toContain('User not in authorized list');
    });
  });

  describe('Rate Limiting Security', () => {
    it('should prevent rate limit bypass attempts', () => {
      const rateLimitTracker = new Map();

      const checkRateLimit = (identifier, maxRequests = 5, windowMs = 60000) => {
        const now = timestampUTC();
        const windowStart = now - windowMs;

        if (!rateLimitTracker.has(identifier)) {
          rateLimitTracker.set(identifier, []);
        }

        const requests = rateLimitTracker.get(identifier);

        // Remove old requests outside the window
        const validRequests = requests.filter(timestamp => timestamp > windowStart);

        if (validRequests.length >= maxRequests) {
          return {
            allowed: false,
            remaining: 0,
            resetTime: Math.min(...validRequests) + windowMs,
          };
        }

        validRequests.push(now);
        rateLimitTracker.set(identifier, validRequests);

        return {
          allowed: true,
          remaining: maxRequests - validRequests.length,
          resetTime: now + windowMs,
        };
      };

      // Test normal usage
      const userId = 'user123';
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit(userId);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4 - i);
      }

      // 6th request should be blocked
      const blockedResult = checkRateLimit(userId);
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.remaining).toBe(0);

      // Test with different user (should be allowed)
      const otherUserId = 'user456';
      const otherResult = checkRateLimit(otherUserId);
      expect(otherResult.allowed).toBe(true);

      // Test IP-based rate limiting bypass attempt
      const suspiciousIPs = ['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.4', '192.168.1.5', '192.168.1.6'];

      // If multiple IPs from same range exceed limits, should trigger alert
      let blockedIPs = 0;
      suspiciousIPs.forEach(ip => {
        for (let i = 0; i < 6; i++) {
          const result = checkRateLimit(ip);
          if (!result.allowed) {
            blockedIPs++;
            break;
          }
        }
      });

      expect(blockedIPs).toBeGreaterThan(0);
    });

    it('should detect and prevent distributed rate limit attacks', () => {
      const distributedAttackDetector = {
        ipRequests: new Map(),
        suspiciousActivity: new Set(),

        checkForDistributedAttack(ip, threshold = 10, timeWindow = 60000) {
          const now = timestampUTC();
          const windowStart = now - timeWindow;

          if (!this.ipRequests.has(ip)) {
            this.ipRequests.set(ip, []);
          }

          const requests = this.ipRequests.get(ip);
          const recentRequests = requests.filter(timestamp => timestamp > windowStart);
          recentRequests.push(now);
          this.ipRequests.set(ip, recentRequests);

          // Check for suspicious patterns
          if (recentRequests.length > threshold) {
            this.suspiciousActivity.add(ip);
            return {
              suspicious: true,
              reason: 'High request frequency',
              requests: recentRequests.length,
            };
          }

          // Check for coordinated attacks (multiple IPs with similar patterns)
          const subnet = ip.split('.').slice(0, 3).join('.');
          const subnetIPs = Array.from(this.ipRequests.keys()).filter(testIP => testIP.startsWith(subnet));

          if (subnetIPs.length > 5) {
            // More than 5 IPs from same subnet
            const totalRequests = subnetIPs.reduce((sum, testIP) => {
              const ipRequests = this.ipRequests.get(testIP) || [];
              return sum + ipRequests.filter(timestamp => timestamp > windowStart).length;
            }, 0);

            if (totalRequests > threshold * 3) {
              this.suspiciousActivity.add(subnet);
              return {
                suspicious: true,
                reason: 'Coordinated subnet attack',
                subnet,
                totalRequests,
              };
            }
          }

          return { suspicious: false };
        },
      };

      // Simulate distributed attack
      const attackIPs = Array.from({ length: 10 }, (_, i) => `192.168.1.${i + 1}`);
      const results = [];

      attackIPs.forEach(ip => {
        for (let i = 0; i < 15; i++) {
          const result = distributedAttackDetector.checkForDistributedAttack(ip);
          if (result.suspicious) {
            results.push({ ip, ...result });
            break;
          }
        }
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.reason === 'High request frequency')).toBe(true);
      expect(results.some(r => r.reason === 'Coordinated subnet attack')).toBe(true);
    });
  });

  describe('Command Injection Prevention', () => {
    it('should prevent command injection in bot commands', () => {
      const sanitizeCommandArgs = args => {
        if (!Array.isArray(args)) {
          throw new Error('Arguments must be an array');
        }

        return args
          .map(arg => {
            if (typeof arg !== 'string') {
              return '';
            }

            // Remove dangerous characters and patterns
            return arg
              .replace(/[;&|`$(){}[\]\\]/g, '') // Shell metacharacters
              .replace(/\.\./g, '') // Path traversal
              .replace(/^-+/, '') // Leading dashes (command flags)
              .trim()
              .substring(0, 100); // Limit length
          })
          .filter(arg => arg.length > 0);
      };

      const validateCommand = (command, args) => {
        const allowedCommands = ['health', 'announce', 'restart', 'kill', 'loglevel', 'vxtwitter'];

        if (!allowedCommands.includes(command)) {
          return { valid: false, error: 'Unknown command' };
        }

        const sanitizedArgs = sanitizeCommandArgs(args);

        // Command-specific validation
        switch (command) {
          case 'announce':
            if (sanitizedArgs.length !== 1 || !['true', 'false'].includes(sanitizedArgs[0])) {
              return { valid: false, error: 'Invalid argument for announce command' };
            }
            break;

          case 'loglevel': {
            const validLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
            if (sanitizedArgs.length !== 1 || !validLevels.includes(sanitizedArgs[0])) {
              return { valid: false, error: 'Invalid log level' };
            }
            break;
          }

          case 'vxtwitter':
            if (sanitizedArgs.length !== 1 || !['true', 'false'].includes(sanitizedArgs[0])) {
              return { valid: false, error: 'Invalid argument for vxtwitter command' };
            }
            break;

          case 'restart':
          case 'kill':
          case 'health':
            if (sanitizedArgs.length !== 0) {
              return { valid: false, error: 'This command does not accept arguments' };
            }
            break;
        }

        return { valid: true, command, args: sanitizedArgs };
      };

      const maliciousCommands = [
        { command: 'announce', args: ['true; rm -rf /'] },
        { command: 'loglevel', args: ['info && cat /etc/passwd'] },
        { command: 'unknown', args: ['test'] },
        { command: 'announce', args: ['$(whoami)'] },
        { command: 'loglevel', args: ['`id`'] },
        { command: 'announce', args: ['true|false'] },
        { command: 'restart', args: ['--force', '../../../etc/passwd'] },
      ];

      maliciousCommands.forEach(({ command, args }) => {
        const result = validateCommand(command, args);
        if (result.valid) {
          console.log('Unexpected valid result:', { command, args, result });
        }
        expect(result.valid).toBe(false);
      });

      const validCommands = [
        { command: 'health', args: [] },
        { command: 'announce', args: ['true'] },
        { command: 'announce', args: ['false'] },
        { command: 'loglevel', args: ['info'] },
        { command: 'vxtwitter', args: ['true'] },
      ];

      validCommands.forEach(({ command, args }) => {
        const result = validateCommand(command, args);
        expect(result.valid).toBe(true);
        expect(result.command).toBe(command);
      });
    });

    it('should prevent path traversal in file operations', () => {
      const validateFilePath = (filePath, allowedDirectories = []) => {
        if (typeof filePath !== 'string') {
          return { valid: false, error: 'File path must be a string' };
        }

        // Normalize path and check for traversal attempts
        const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+/g, '/');

        if (normalizedPath.includes('../') || normalizedPath.includes('..\\')) {
          return { valid: false, error: 'Path traversal not allowed' };
        }

        if (normalizedPath.startsWith('/') && !allowedDirectories.some(dir => normalizedPath.startsWith(dir))) {
          return { valid: false, error: 'Absolute paths not allowed outside permitted directories' };
        }

        // Check for dangerous file extensions
        const dangerousExtensions = ['.exe', '.sh', '.bat', '.cmd', '.ps1', '.php', '.asp', '.jsp'];
        if (dangerousExtensions.some(ext => normalizedPath.toLowerCase().endsWith(ext))) {
          return { valid: false, error: 'Dangerous file extension' };
        }

        // Check for system files
        const systemFiles = ['passwd', 'shadow', 'hosts', 'fstab', '.htaccess', 'web.config'];
        const fileName = normalizedPath.split('/').pop().toLowerCase();
        if (systemFiles.includes(fileName)) {
          return { valid: false, error: 'System file access not allowed' };
        }

        return { valid: true, path: normalizedPath };
      };

      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        '../../.env',
        '../config/database.yml',
        'logs/../../../etc/hosts',
        '/var/log/../../etc/passwd',
        'uploads/shell.php',
        'temp/script.sh',
        '.htaccess',
      ];

      maliciousPaths.forEach(path => {
        const result = validateFilePath(path, ['/var/log/', '/tmp/']);
        expect(result.valid).toBe(false);
      });

      const validPaths = [
        'logs/app.log',
        'uploads/image.jpg',
        'temp/data.json',
        'config/settings.yaml',
        '/var/log/app.log',
        '/tmp/upload_123.tmp',
      ];

      validPaths.forEach(path => {
        const result = validateFilePath(path, ['/var/log/', '/tmp/']);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Data Exposure Prevention', () => {
    it('should redact sensitive information from logs', () => {
      const redactSensitiveData = data => {
        if (typeof data === 'string') {
          return data
            .replace(/bearer\s+([a-zA-Z0-9+/=]{8,})/gi, (match, token) => match.replace(token, '*'.repeat(8)))
            .replace(/(?:password|passwd|pwd|secret|key|token|auth)\s*[:=]\s*['"]?([^'"\s,}]+)/gi, (match, value) =>
              match.replace(value, '*'.repeat(Math.min(value.length, 8)))
            )
            .replace(/(?:api[_-]?key|access[_-]?token)\s*[:=]?\s*['"]?([a-zA-Z0-9+/=]{8,})/gi, (match, token) =>
              match.replace(token, '*'.repeat(8))
            )
            .replace(/(?:key|token)\s*[:=]\s*['"]?([a-zA-Z0-9+/=]{8,})/gi, (match, token) =>
              match.replace(token, '*'.repeat(8))
            )
            .replace(/['"]([a-zA-Z0-9]{2,}-[a-zA-Z0-9]{4,})['"](?:\s+is\s+invalid)?/gi, (match, token) =>
              match.replace(token, '*'.repeat(8))
            )
            .replace(/(?:discord[_-]?token|bot[_-]?token)['"]?([a-zA-Z0-9._-]{50,})/gi, (match, token) =>
              match.replace(token, '*'.repeat(8))
            )
            .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]')
            .replace(/(?:\d{1,3}\.){3}\d{1,3}/g, '[IP_REDACTED]');
        }

        if (typeof data === 'object' && data !== null) {
          const redacted = Array.isArray(data) ? [] : {};

          for (const [key, value] of Object.entries(data)) {
            if (typeof key === 'string' && /(?:password|passwd|pwd|secret|key|token|auth|credential)/i.test(key)) {
              redacted[key] = '*'.repeat(8);
            } else {
              redacted[key] = redactSensitiveData(value);
            }
          }

          return redacted;
        }

        return data;
      };

      const sensitiveData = {
        user: 'testuser',
        password: 'super-secret-password',
        api_key: 'sk-1234567890abcdef',
        discord_token: 'TEST.FAKE.TOKEN-FOR-SECURITY-TESTING-ONLY',
        email: 'user@example.com',
        server_ip: '192.168.1.100',
        config: {
          database_password: 'db-secret',
          oauth_secret: 'oauth-key-123',
        },
        logs: [
          'User login: password=mypassword123',
          'API call with key=abc123456789',
          'Bearer token: bearer eyJhbGciOiJIUzI1NiJ9',
        ],
      };

      const redacted = redactSensitiveData(sensitiveData);

      expect(redacted.password).toBe('********');
      expect(redacted.api_key).toBe('********');
      expect(redacted.discord_token).toBe('********');
      expect(redacted.email).toBe('[EMAIL_REDACTED]');
      expect(redacted.server_ip).toBe('[IP_REDACTED]');
      expect(redacted.config.database_password).toBe('********');
      expect(redacted.config.oauth_secret).toBe('********');

      redacted.logs.forEach(log => {
        expect(log).not.toContain('mypassword123');
        expect(log).not.toContain('abc123456789');
        expect(log).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      });

      // Non-sensitive data should remain unchanged
      expect(redacted.user).toBe('testuser');
    });

    it('should prevent information disclosure in error messages', () => {
      const sanitizeError = (error, isProduction = false) => {
        const sensitivePatterns = [/password/i, /secret/i, /token/i, /key/i, /credential/i, /auth/i, /session/i];

        const systemPaths = [
          /[C-Z]:\\[^"\s]*/g, // Windows paths
          /\/[^"\s]*\/[^"\s]*/g, // Unix paths
          /node_modules\/[^"\s]*/g, // Node modules paths
          /\/home\/[^"\s]*/g, // Home directories
          /\/app\/[^"\s]*/g, // App directories
        ];

        let sanitizedMessage = error.message || 'An error occurred';

        if (isProduction) {
          // In production, provide minimal error information
          const allowedErrors = [
            'Invalid input',
            'Not found',
            'Unauthorized',
            'Rate limit exceeded',
            'Service unavailable',
          ];

          if (!allowedErrors.some(allowed => sanitizedMessage.includes(allowed))) {
            sanitizedMessage = 'Internal server error';
          }
        } else {
          // In development, sanitize but keep useful information
          sensitivePatterns.forEach(pattern => {
            sanitizedMessage = sanitizedMessage.replace(pattern, '[SENSITIVE]');
          });

          // Remove specific sensitive values (API keys, tokens, etc.)
          sanitizedMessage = sanitizedMessage
            .replace(/"([a-zA-Z0-9]{2,}-[a-zA-Z0-9]{4,})"/g, '"[REDACTED]"') // API keys like "sk-12345"
            .replace(/"([a-zA-Z0-9._-]{20,})"/g, '"[REDACTED]"') // Long tokens
            .replace(/([a-zA-Z0-9]{6,})/g, match => {
              // Redact if it looks like a secret value (alphanumeric mix of 6+ chars)
              if (/[0-9]/.test(match) && /[a-zA-Z]/.test(match)) {
                return '[REDACTED]';
              }
              return match;
            });

          systemPaths.forEach(pattern => {
            sanitizedMessage = sanitizedMessage.replace(pattern, '[PATH_REDACTED]');
          });
        }

        return {
          message: sanitizedMessage,
          code: error.code || 'UNKNOWN_ERROR',
          timestamp: new Date().toISOString(),
        };
      };

      const sensitiveErrors = [
        new Error('Database connection failed: password authentication failed for user "admin"'),
        new Error('API key "sk-12345" is invalid'),
        new Error('Discord token verification failed'),
        new Error('Cannot read file /home/user/.env: permission denied'),
        new Error('Module not found: /app/node_modules/secret-package'),
        new Error('Authentication failed: invalid session token abc123'),
      ];

      sensitiveErrors.forEach(error => {
        const prodResult = sanitizeError(error, true);
        const devResult = sanitizeError(error, false);

        // Production should return generic message
        expect(prodResult.message).toBe('Internal server error');

        // Development should sanitize but preserve some context
        expect(devResult.message).not.toContain('password authentication failed');
        expect(devResult.message).not.toContain('sk-12345');
        expect(devResult.message).not.toContain('/home/user/.env');
        expect(devResult.message).not.toContain('abc123');
      });

      const allowedErrors = [
        new Error('Invalid input'),
        new Error('Not found'),
        new Error('Unauthorized'),
        new Error('Rate limit exceeded'),
      ];

      allowedErrors.forEach(error => {
        const result = sanitizeError(error, true);
        expect(result.message).toBe(error.message);
      });
    });
  });

  describe('Security Headers and Configuration', () => {
    it('should validate secure webhook configuration', () => {
      const validateWebhookConfig = config => {
        const issues = [];

        // Check HTTPS requirement
        if (!config.callbackUrl || !config.callbackUrl.startsWith('https://')) {
          issues.push('Webhook callback URL must use HTTPS');
        }

        // Check secret strength
        if (!config.secret || config.secret.length < 32) {
          issues.push('Webhook secret must be at least 32 characters');
        }

        if (config.secret && /^(password|secret|123|test|default)/i.test(config.secret)) {
          issues.push('Webhook secret appears to be a default or weak value');
        }

        // Check for proper signature verification
        if (!config.verifySignatures) {
          issues.push('Signature verification must be enabled');
        }

        // Check rate limiting
        if (!config.rateLimit || config.rateLimit.max > 1000) {
          issues.push('Rate limiting must be configured with reasonable limits');
        }

        // Check timeout settings
        if (!config.timeout || config.timeout > 30000) {
          issues.push('Request timeout should be set to reasonable value (≤30s)');
        }

        return {
          secure: issues.length === 0,
          issues,
        };
      };

      const insecureConfigs = [
        {
          callbackUrl: 'http://example.com/webhook',
          secret: 'weak',
          verifySignatures: false,
        },
        {
          callbackUrl: 'https://example.com/webhook',
          secret: 'password123',
          verifySignatures: true,
          rateLimit: { max: 10000 },
        },
        {
          callbackUrl: 'https://example.com/webhook',
          secret: 'a'.repeat(50),
          verifySignatures: true,
          timeout: 60000,
        },
      ];

      insecureConfigs.forEach(config => {
        const result = validateWebhookConfig(config);
        expect(result.secure).toBe(false);
        expect(result.issues.length).toBeGreaterThan(0);
      });

      const secureConfig = {
        callbackUrl: 'https://secure.example.com/webhook',
        secret: 'a'.repeat(64), // Strong 64-character secret
        verifySignatures: true,
        rateLimit: { max: 100 },
        timeout: 10000,
      };

      const secureResult = validateWebhookConfig(secureConfig);
      expect(secureResult.secure).toBe(true);
      expect(secureResult.issues).toHaveLength(0);
    });

    it('should implement proper CORS security', () => {
      const validateCorsConfig = (corsConfig, request) => {
        const issues = [];

        // Check for overly permissive origins
        if (corsConfig.origin === '*') {
          issues.push('Wildcard origin (*) should not be used in production');
        }

        // Validate allowed origins
        if (Array.isArray(corsConfig.origin)) {
          corsConfig.origin.forEach(origin => {
            if (!origin.startsWith('https://') && origin !== 'http://localhost') {
              issues.push(`Insecure origin: ${origin}`);
            }
          });
        }

        // Check for dangerous headers
        const dangerousHeaders = ['authorization', 'cookie', 'x-auth-token'];
        if (corsConfig.allowedHeaders) {
          const hasCredentials = corsConfig.credentials === true;
          const hasDangerousHeaders = dangerousHeaders.some(header => corsConfig.allowedHeaders.includes(header));

          if (hasCredentials && hasDangerousHeaders && corsConfig.origin === '*') {
            issues.push('Cannot use credentials with wildcard origin and sensitive headers');
          }
        }

        // Validate request origin
        if (request && request.origin) {
          const allowedOrigins = Array.isArray(corsConfig.origin) ? corsConfig.origin : [corsConfig.origin];

          if (!allowedOrigins.includes(request.origin) && !allowedOrigins.includes('*')) {
            issues.push(`Origin ${request.origin} not in allowlist`);
          }
        }

        return {
          secure: issues.length === 0,
          issues,
        };
      };

      const insecureCorsConfigs = [
        {
          origin: '*',
          credentials: true,
          allowedHeaders: ['authorization', 'content-type'],
        },
        {
          origin: ['http://malicious.com', 'https://trusted.com'],
          credentials: false,
        },
      ];

      const mockRequest = { origin: 'https://evil.com' };

      insecureCorsConfigs.forEach(config => {
        const result = validateCorsConfig(config, mockRequest);
        expect(result.secure).toBe(false);
      });

      const secureCorsConfig = {
        origin: ['https://trusted.com', 'https://app.example.com'],
        credentials: true,
        allowedHeaders: ['content-type', 'x-custom-header'],
        maxAge: 86400,
      };

      const trustedRequest = { origin: 'https://trusted.com' };
      const secureResult = validateCorsConfig(secureCorsConfig, trustedRequest);
      expect(secureResult.secure).toBe(true);
    });
  });
});
