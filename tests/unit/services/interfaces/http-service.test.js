/**
 * @fileoverview Tests for HttpService interface contract
 */

import { HttpService } from '../../../../src/services/interfaces/http-service.js';

describe('HttpService Interface', () => {
  let service;

  beforeEach(() => {
    service = new HttpService();
  });

  describe('Interface Contract', () => {
    it('should define all required methods', () => {
      const requiredMethods = [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'head',
        'request',
        'downloadFile',
        'uploadFile',
        'setDefaultHeaders',
        'setTimeout',
        'setBaseUrl',
        'addRequestInterceptor',
        'addResponseInterceptor',
        'createInstance',
        'validateUrl',
        'buildQueryString',
        'joinUrlPath',
        'isSuccessResponse',
        'isClientError',
        'isServerError',
        'getContentType',
        'isJsonResponse',
        'dispose',
      ];

      requiredMethods.forEach(method => {
        expect(service[method]).toBeDefined();
        expect(typeof service[method]).toBe('function');
      });
    });

    it('should be an abstract class throwing errors on HTTP method calls', async () => {
      const httpMethods = [
        { name: 'get', args: ['https://example.com'] },
        { name: 'post', args: ['https://example.com', { data: 'test' }] },
        { name: 'put', args: ['https://example.com', { data: 'test' }] },
        { name: 'delete', args: ['https://example.com'] },
        { name: 'patch', args: ['https://example.com', { data: 'test' }] },
        { name: 'head', args: ['https://example.com'] },
        { name: 'request', args: ['GET', 'https://example.com'] },
      ];

      for (const method of httpMethods) {
        await expect(service[method.name](...method.args)).rejects.toThrow(
          `Abstract method: ${method.name} must be implemented`
        );
      }
    });

    it('should throw errors on file operation methods', async () => {
      await expect(service.downloadFile('https://example.com/file.txt', '/tmp/file.txt')).rejects.toThrow(
        'Abstract method: downloadFile must be implemented'
      );

      await expect(service.uploadFile('https://example.com/upload', '/tmp/file.txt')).rejects.toThrow(
        'Abstract method: uploadFile must be implemented'
      );
    });

    it('should throw errors on configuration methods', () => {
      const configMethods = [
        { name: 'setDefaultHeaders', args: [{}] },
        { name: 'setTimeout', args: [5000] },
        { name: 'setBaseUrl', args: ['https://api.example.com'] },
        { name: 'addRequestInterceptor', args: [() => {}] },
        { name: 'addResponseInterceptor', args: [() => {}] },
        { name: 'createInstance', args: [{}] },
      ];

      configMethods.forEach(method => {
        expect(() => service[method.name](...method.args)).toThrow(
          `Abstract method: ${method.name} must be implemented`
        );
      });
    });
  });

  describe('HTTP Method Signatures', () => {
    it('should validate GET method signature', () => {
      expect(service.get).toBeDefined();
      expect(service.get).toHaveLength(1); // url parameter (options handled by eslint disable)
    });

    it('should validate POST method signature', () => {
      expect(service.post).toBeDefined();
      expect(service.post).toHaveLength(1); // url parameter (data has default value)
    });

    it('should validate PUT method signature', () => {
      expect(service.put).toBeDefined();
      expect(service.put).toHaveLength(1); // url parameter (data has default value)
    });

    it('should validate DELETE method signature', () => {
      expect(service.delete).toBeDefined();
      expect(service.delete).toHaveLength(1); // url parameter
    });

    it('should validate PATCH method signature', () => {
      expect(service.patch).toBeDefined();
      expect(service.patch).toHaveLength(1); // url parameter (data has default value)
    });

    it('should validate HEAD method signature', () => {
      expect(service.head).toBeDefined();
      expect(service.head).toHaveLength(1); // url parameter
    });

    it('should validate generic request method signature', () => {
      expect(service.request).toBeDefined();
      expect(service.request).toHaveLength(2); // method, url parameters (data has default value)
    });
  });

  describe('Utility Methods Implementation', () => {
    describe('validateUrl', () => {
      it('should validate correct URLs', () => {
        const validUrls = [
          'https://example.com',
          'http://localhost:3000',
          'https://api.github.com/users/test',
          'ftp://files.example.com/file.txt',
          'ws://websocket.example.com',
        ];

        validUrls.forEach(url => {
          expect(service.validateUrl(url)).toBe(true);
        });
      });

      it('should reject invalid URLs', () => {
        const invalidUrls = [
          '',
          'not-a-url',
          'example.com', // missing protocol
          'http://',
          null,
          undefined,
          123,
          {},
        ];

        invalidUrls.forEach(url => {
          expect(service.validateUrl(url)).toBe(false);
        });
      });

      it('should handle non-string input', () => {
        expect(service.validateUrl(123)).toBe(false);
        expect(service.validateUrl(null)).toBe(false);
        expect(service.validateUrl(undefined)).toBe(false);
        expect(service.validateUrl({})).toBe(false);
        expect(service.validateUrl([])).toBe(false);
      });
    });

    describe('buildQueryString', () => {
      it('should build query string from object', () => {
        const params = {
          q: 'search term',
          page: 1,
          limit: 10,
        };

        const result = service.buildQueryString(params);
        expect(result).toBe('q=search+term&page=1&limit=10');
      });

      it('should handle array values', () => {
        const params = {
          tags: ['javascript', 'nodejs'],
          ids: [1, 2, 3],
        };

        const result = service.buildQueryString(params);
        expect(result).toContain('tags=javascript');
        expect(result).toContain('tags=nodejs');
        expect(result).toContain('ids=1');
        expect(result).toContain('ids=2');
        expect(result).toContain('ids=3');
      });

      it('should skip null and undefined values', () => {
        const params = {
          a: 'value',
          b: null,
          c: undefined,
          d: 'another',
        };

        const result = service.buildQueryString(params);
        expect(result).toContain('a=value');
        expect(result).toContain('d=another');
        expect(result).not.toContain('b=');
        expect(result).not.toContain('c=');
      });

      it('should handle empty or invalid input', () => {
        expect(service.buildQueryString(null)).toBe('');
        expect(service.buildQueryString(undefined)).toBe('');
        expect(service.buildQueryString({})).toBe('');
        expect(service.buildQueryString('string')).toBe('');
      });
    });

    describe('joinUrlPath', () => {
      it('should join URL path segments', () => {
        expect(service.joinUrlPath('api', 'v1', 'users')).toBe('api/v1/users');
        expect(service.joinUrlPath('/api/', '/v1/', '/users/')).toBe('api/v1/users');
        expect(service.joinUrlPath('api/', 'v1', '/users')).toBe('api/v1/users');
      });

      it('should handle empty segments', () => {
        expect(service.joinUrlPath('api', '', 'users')).toBe('api/users');
        expect(service.joinUrlPath('api', null, 'users')).toBe('api/users');
        expect(service.joinUrlPath('api', undefined, 'users')).toBe('api/users');
      });

      it('should handle numbers and other types', () => {
        expect(service.joinUrlPath('api', 'v1', 123, 'details')).toBe('api/v1/123/details');
      });
    });

    describe('Response Status Helpers', () => {
      it('should identify success responses', () => {
        const successResponses = [{ status: 200 }, { status: 201 }, { status: 204 }, { status: 299 }];

        successResponses.forEach(response => {
          expect(service.isSuccessResponse(response)).toBe(true);
        });
      });

      it('should identify client error responses', () => {
        const clientErrorResponses = [{ status: 400 }, { status: 401 }, { status: 404 }, { status: 499 }];

        clientErrorResponses.forEach(response => {
          expect(service.isClientError(response)).toBe(true);
        });
      });

      it('should identify server error responses', () => {
        const serverErrorResponses = [{ status: 500 }, { status: 502 }, { status: 503 }, { status: 599 }];

        serverErrorResponses.forEach(response => {
          expect(service.isServerError(response)).toBe(true);
        });
      });

      it('should handle invalid responses', () => {
        const invalidResponses = [null, undefined, {}, { status: 'invalid' }];

        invalidResponses.forEach(response => {
          // All methods should return falsy values for invalid responses
          expect(service.isSuccessResponse(response)).toBeFalsy();
          expect(service.isClientError(response)).toBeFalsy();
          expect(service.isServerError(response)).toBeFalsy();
        });
      });
    });

    describe('Content Type Helpers', () => {
      it('should extract content type from response headers', () => {
        const response = {
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        };

        expect(service.getContentType(response)).toBe('application/json');
      });

      it('should handle case-insensitive headers', () => {
        const response = {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        };

        expect(service.getContentType(response)).toBe('text/html');
      });

      it('should return null for missing content type', () => {
        expect(service.getContentType({})).toBe(null);
        expect(service.getContentType({ headers: {} })).toBe(null);
        expect(service.getContentType(null)).toBe(null);
      });

      it('should identify JSON responses', () => {
        const jsonResponse = {
          headers: {
            'content-type': 'application/json',
          },
        };

        const htmlResponse = {
          headers: {
            'content-type': 'text/html',
          },
        };

        expect(service.isJsonResponse(jsonResponse)).toBe(true);
        expect(service.isJsonResponse(htmlResponse)).toBe(false);
      });
    });
  });

  describe('File Operations', () => {
    it('should handle file download operations', async () => {
      const url = 'https://example.com/file.zip';
      const destination = '/tmp/downloaded-file.zip';

      await expect(service.downloadFile(url, destination)).rejects.toThrow(
        'Abstract method: downloadFile must be implemented'
      );
    });

    it('should handle file upload operations', async () => {
      const url = 'https://example.com/upload';
      const file = '/tmp/upload-file.txt';

      await expect(service.uploadFile(url, file)).rejects.toThrow('Abstract method: uploadFile must be implemented');
    });
  });

  describe('Configuration Methods', () => {
    it('should handle default headers configuration', () => {
      const headers = {
        Authorization: 'Bearer token',
        'User-Agent': 'Test Client',
      };

      expect(() => service.setDefaultHeaders(headers)).toThrow(
        'Abstract method: setDefaultHeaders must be implemented'
      );
    });

    it('should handle timeout configuration', () => {
      expect(() => service.setTimeout(5000)).toThrow('Abstract method: setTimeout must be implemented');
    });

    it('should handle base URL configuration', () => {
      expect(() => service.setBaseUrl('https://api.example.com')).toThrow(
        'Abstract method: setBaseUrl must be implemented'
      );
    });
  });

  describe('Interceptor Methods', () => {
    it('should handle request interceptor registration', () => {
      const interceptor = config => config;

      expect(() => service.addRequestInterceptor(interceptor)).toThrow(
        'Abstract method: addRequestInterceptor must be implemented'
      );
    });

    it('should handle response interceptor registration', () => {
      const interceptor = response => response;

      expect(() => service.addResponseInterceptor(interceptor)).toThrow(
        'Abstract method: addResponseInterceptor must be implemented'
      );
    });
  });

  describe('Instance Creation', () => {
    it('should handle instance creation', () => {
      const config = {
        baseURL: 'https://api.example.com',
        timeout: 5000,
      };

      expect(() => service.createInstance(config)).toThrow('Abstract method: createInstance must be implemented');
    });
  });

  describe('Resource Management', () => {
    it('should have dispose method', () => {
      expect(service.dispose).toBeDefined();
      expect(typeof service.dispose).toBe('function');
    });

    it('should implement dispose method with no-op', async () => {
      // Default implementation should not throw
      await expect(service.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Default Parameter Handling', () => {
    it('should handle methods with default null data parameter', async () => {
      await expect(service.post('https://example.com')).rejects.toThrow('Abstract method: post must be implemented');

      await expect(service.put('https://example.com')).rejects.toThrow('Abstract method: put must be implemented');

      await expect(service.patch('https://example.com')).rejects.toThrow('Abstract method: patch must be implemented');

      await expect(service.request('GET', 'https://example.com')).rejects.toThrow(
        'Abstract method: request must be implemented'
      );
    });
  });
});
