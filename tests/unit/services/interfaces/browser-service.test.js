/**
 * @fileoverview Tests for BrowserService interface contract
 */

import { BrowserService } from '../../../../src/services/interfaces/browser-service.js';

describe('BrowserService Interface', () => {
  let service;

  beforeEach(() => {
    service = new BrowserService();
  });

  describe('Interface Contract', () => {
    it('should define all required methods', () => {
      const requiredMethods = [
        'launch',
        'newPage',
        'goto',
        'waitForSelector',
        'waitForNavigation',
        'evaluate',
        'type',
        'click',
        'getTextContent',
        'getAttribute',
        'screenshot',
        'setCookies',
        'getCookies',
        'setUserAgent',
        'setViewport',
        'waitFor',
        'waitForFunction',
        'getContent',
        'getCurrentUrl',
        'elementExists',
        'getElements',
        'closePage',
        'close',
        'isRunning',
        'isConnected',
        'isClosed',
        'dispose',
      ];

      requiredMethods.forEach(method => {
        expect(service[method]).toBeDefined();
        expect(typeof service[method]).toBe('function');
      });
    });

    it('should be an abstract class throwing errors on method calls', async () => {
      const methods = [
        { name: 'launch', args: [{}] },
        { name: 'newPage', args: [] },
        { name: 'goto', args: ['https://example.com'] },
        { name: 'waitForSelector', args: ['.selector'] },
        { name: 'waitForNavigation', args: [] },
        { name: 'evaluate', args: ['() => {}'] },
        { name: 'type', args: ['.input', 'text'] },
        { name: 'click', args: ['.button'] },
        { name: 'getTextContent', args: ['.element'] },
        { name: 'getAttribute', args: ['.element', 'href'] },
        { name: 'screenshot', args: [] },
        { name: 'setCookies', args: [[]] },
        { name: 'getCookies', args: [] },
        { name: 'setUserAgent', args: ['Mozilla/5.0'] },
        { name: 'setViewport', args: [{ width: 1920, height: 1080 }] },
        { name: 'waitFor', args: [1000] },
        { name: 'waitForFunction', args: ['() => true'] },
        { name: 'getContent', args: [] },
        { name: 'getCurrentUrl', args: [] },
        { name: 'elementExists', args: ['.element'] },
        { name: 'getElements', args: ['.elements'] },
        { name: 'closePage', args: [] },
        { name: 'close', args: [] },
      ];

      for (const method of methods) {
        await expect(service[method.name](...method.args)).rejects.toThrow(
          `Abstract method: ${method.name} must be implemented`
        );
      }
    });

    it('should throw errors on synchronous methods', () => {
      const syncMethods = ['isRunning', 'isConnected', 'isClosed'];

      syncMethods.forEach(method => {
        expect(() => service[method]()).toThrow(`Abstract method: ${method} must be implemented`);
      });
    });
  });

  describe('Method Signatures', () => {
    it('should validate launch method signature', () => {
      expect(service.launch).toBeDefined();
      expect(service.launch).toHaveLength(0); // options parameter has default value
    });

    it('should validate navigation method signatures', () => {
      expect(service.goto).toBeDefined();
      expect(service.goto).toHaveLength(1); // url parameter (options has default)

      expect(service.waitForNavigation).toBeDefined();
      expect(service.waitForNavigation).toHaveLength(0); // options has default value
    });

    it('should validate interaction method signatures', () => {
      expect(service.type).toBeDefined();
      expect(service.type).toHaveLength(2); // selector, text parameters (options has default)

      expect(service.click).toBeDefined();
      expect(service.click).toHaveLength(1); // selector parameter (options has default)
    });

    it('should validate evaluation method signatures', () => {
      expect(service.evaluate).toBeDefined();
      expect(service.evaluate).toHaveLength(1); // _script parameter (rest parameters)

      expect(service.waitForFunction).toBeDefined();
      expect(service.waitForFunction).toHaveLength(1); // fn parameter (options has default)
    });

    it('should validate cookie management method signatures', () => {
      expect(service.setCookies).toBeDefined();
      expect(service.setCookies).toHaveLength(1); // cookies parameter

      expect(service.getCookies).toBeDefined();
      expect(service.getCookies).toHaveLength(0); // urls parameter has default value
    });
  });

  describe('Parameter Validation', () => {
    it('should handle default parameters correctly', async () => {
      // Test methods with default parameters
      const methodsWithDefaults = [
        { name: 'launch', args: [] }, // options = {}
        { name: 'goto', args: ['https://example.com'] }, // options = {}
        { name: 'waitForSelector', args: ['.selector'] }, // options = {}
        { name: 'type', args: ['.input', 'text'] }, // options = {}
        { name: 'click', args: ['.button'] }, // options = {}
        { name: 'screenshot', args: [] }, // options = {}
        { name: 'getCookies', args: [] }, // urls = []
        { name: 'waitForFunction', args: ['() => true'] }, // options = {}
      ];

      for (const method of methodsWithDefaults) {
        await expect(service[method.name](...method.args)).rejects.toThrow(
          `Abstract method: ${method.name} must be implemented`
        );
      }
    });

    it('should validate required parameters', async () => {
      const requiredParamMethods = [
        { name: 'goto', args: [] }, // url is required
        { name: 'waitForSelector', args: [] }, // selector is required
        { name: 'type', args: ['.input'] }, // text is required
        { name: 'click', args: [] }, // selector is required
        { name: 'getTextContent', args: [] }, // selector is required
        { name: 'getAttribute', args: ['.element'] }, // attribute is required
        { name: 'setUserAgent', args: [] }, // userAgent is required
        { name: 'setViewport', args: [] }, // viewport is required
        { name: 'waitFor', args: [] }, // ms is required
        { name: 'waitForFunction', args: [] }, // fn is required
        { name: 'elementExists', args: [] }, // selector is required
        { name: 'getElements', args: [] }, // selector is required
      ];

      for (const method of requiredParamMethods) {
        await expect(service[method.name](...method.args)).rejects.toThrow(
          `Abstract method: ${method.name} must be implemented`
        );
      }
    });
  });

  describe('State Management Methods', () => {
    it('should have browser state methods', () => {
      expect(service.isRunning).toBeDefined();
      expect(service.isConnected).toBeDefined();
      expect(service.isClosed).toBeDefined();
      expect(typeof service.isRunning).toBe('function');
      expect(typeof service.isConnected).toBe('function');
      expect(typeof service.isClosed).toBe('function');
    });

    it('should throw on state check methods', () => {
      expect(() => service.isRunning()).toThrow('Abstract method: isRunning must be implemented');
      expect(() => service.isConnected()).toThrow('Abstract method: isConnected must be implemented');
      expect(() => service.isClosed()).toThrow('Abstract method: isClosed must be implemented');
    });
  });

  describe('Resource Management', () => {
    it('should have disposal methods', () => {
      expect(service.close).toBeDefined();
      expect(service.closePage).toBeDefined();
      expect(service.dispose).toBeDefined();
    });

    it('should implement dispose method that calls close', async () => {
      // Since close is abstract, we expect the dispose to call it and get the error
      await expect(service.dispose()).rejects.toThrow('Abstract method: close must be implemented');
    });
  });

  describe('Cookie Management', () => {
    it('should handle cookie operations', async () => {
      const cookies = [{ name: 'session', value: 'abc123', domain: 'example.com' }];

      await expect(service.setCookies(cookies)).rejects.toThrow('Abstract method: setCookies must be implemented');

      await expect(service.getCookies(['https://example.com'])).rejects.toThrow(
        'Abstract method: getCookies must be implemented'
      );
    });
  });

  describe('Element Operations', () => {
    it('should handle element interaction methods', async () => {
      const selector = '.test-element';
      const text = 'test text';

      await expect(service.getTextContent(selector)).rejects.toThrow(
        'Abstract method: getTextContent must be implemented'
      );

      await expect(service.getAttribute(selector, 'href')).rejects.toThrow(
        'Abstract method: getAttribute must be implemented'
      );

      await expect(service.elementExists(selector)).rejects.toThrow(
        'Abstract method: elementExists must be implemented'
      );

      await expect(service.getElements(selector)).rejects.toThrow('Abstract method: getElements must be implemented');

      await expect(service.type(selector, text)).rejects.toThrow('Abstract method: type must be implemented');

      await expect(service.click(selector)).rejects.toThrow('Abstract method: click must be implemented');
    });
  });

  describe('Page Configuration', () => {
    it('should handle viewport and user agent configuration', async () => {
      const viewport = { width: 1920, height: 1080 };
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

      await expect(service.setViewport(viewport)).rejects.toThrow('Abstract method: setViewport must be implemented');

      await expect(service.setUserAgent(userAgent)).rejects.toThrow(
        'Abstract method: setUserAgent must be implemented'
      );
    });
  });

  describe('Wait Operations', () => {
    it('should handle different wait operations', async () => {
      await expect(service.waitFor(1000)).rejects.toThrow('Abstract method: waitFor must be implemented');

      await expect(service.waitForSelector('.element')).rejects.toThrow(
        'Abstract method: waitForSelector must be implemented'
      );

      await expect(service.waitForFunction(() => true)).rejects.toThrow(
        'Abstract method: waitForFunction must be implemented'
      );

      await expect(service.waitForNavigation()).rejects.toThrow(
        'Abstract method: waitForNavigation must be implemented'
      );
    });
  });

  describe('Page Content Access', () => {
    it('should handle page content methods', async () => {
      await expect(service.getContent()).rejects.toThrow('Abstract method: getContent must be implemented');

      await expect(service.getCurrentUrl()).rejects.toThrow('Abstract method: getCurrentUrl must be implemented');

      await expect(service.screenshot()).rejects.toThrow('Abstract method: screenshot must be implemented');
    });
  });

  describe('JavaScript Evaluation', () => {
    it('should handle script evaluation', async () => {
      const script = '() => document.title';
      const scriptWithArgs = '(arg1, arg2) => arg1 + arg2';

      await expect(service.evaluate(script)).rejects.toThrow('Abstract method: evaluate must be implemented');

      await expect(service.evaluate(scriptWithArgs, 'hello', 'world')).rejects.toThrow(
        'Abstract method: evaluate must be implemented'
      );
    });
  });
});
