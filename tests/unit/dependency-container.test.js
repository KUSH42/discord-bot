import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DependencyContainer } from '../../src/infrastructure/dependency-container.js';

describe('DependencyContainer', () => {
  let container;

  beforeEach(() => {
    container = new DependencyContainer();
  });

  afterEach(async () => {
    if (container) {
      await container.dispose();
    }
  });

  describe('constructor', () => {
    it('should initialize with empty services and instances maps', () => {
      expect(container.services).toBeInstanceOf(Map);
      expect(container.instances).toBeInstanceOf(Map);
      expect(container.services.size).toBe(0);
      expect(container.instances.size).toBe(0);
      expect(container.scoped).toBe(false);
    });
  });

  describe('register', () => {
    it('should register a service with default singleton behavior', () => {
      const factory = jest.fn();
      const result = container.register('testService', factory);

      expect(result).toBe(container); // Should be chainable
      expect(container.services.has('testService')).toBe(true);

      const service = container.services.get('testService');
      expect(service.factory).toBe(factory);
      expect(service.singleton).toBe(true);
      expect(service.dependencies).toEqual([]);
      expect(service.initialized).toBe(false);
    });

    it('should register a service with custom options', () => {
      const factory = jest.fn();
      const dependencies = ['dep1', 'dep2'];

      container.register('testService', factory, {
        singleton: false,
        dependencies,
      });

      const service = container.services.get('testService');
      expect(service.singleton).toBe(false);
      expect(service.dependencies).toEqual(dependencies);
    });

    it('should throw error for invalid token', () => {
      const factory = jest.fn();

      expect(() => container.register(123, factory)).toThrow('Service token must be a string');
      expect(() => container.register(null, factory)).toThrow('Service token must be a string');
      expect(() => container.register(undefined, factory)).toThrow('Service token must be a string');
    });

    it('should throw error for invalid factory', () => {
      expect(() => container.register('test', 'not-a-function')).toThrow('Service factory must be a function');
      expect(() => container.register('test', null)).toThrow('Service factory must be a function');
      expect(() => container.register('test', 123)).toThrow('Service factory must be a function');
    });

    it('should allow overwriting existing service registrations', () => {
      const factory1 = jest.fn();
      const factory2 = jest.fn();

      container.register('testService', factory1);
      container.register('testService', factory2);

      const service = container.services.get('testService');
      expect(service.factory).toBe(factory2);
    });
  });

  describe('registerSingleton', () => {
    it('should register service as singleton', () => {
      const factory = jest.fn();
      const result = container.registerSingleton('testService', factory);

      expect(result).toBe(container);
      const service = container.services.get('testService');
      expect(service.singleton).toBe(true);
    });

    it('should override singleton option when explicitly set to false', () => {
      const factory = jest.fn();
      container.registerSingleton('testService', factory, { singleton: false });

      const service = container.services.get('testService');
      expect(service.singleton).toBe(true); // Should force singleton
    });
  });

  describe('registerTransient', () => {
    it('should register service as transient', () => {
      const factory = jest.fn();
      const result = container.registerTransient('testService', factory);

      expect(result).toBe(container);
      const service = container.services.get('testService');
      expect(service.singleton).toBe(false);
    });

    it('should override singleton option when explicitly set to true', () => {
      const factory = jest.fn();
      container.registerTransient('testService', factory, { singleton: true });

      const service = container.services.get('testService');
      expect(service.singleton).toBe(false); // Should force transient
    });
  });

  describe('registerInstance', () => {
    it('should register an instance directly', () => {
      const instance = { value: 'test' };
      const result = container.registerInstance('testInstance', instance);

      expect(result).toBe(container);
      expect(container.instances.has('testInstance')).toBe(true);
      expect(container.instances.get('testInstance')).toBe(instance);
    });

    it('should throw error for invalid token', () => {
      const instance = {};

      expect(() => container.registerInstance(123, instance)).toThrow('Service token must be a string');
      expect(() => container.registerInstance(null, instance)).toThrow('Service token must be a string');
    });

    it('should allow registering null or undefined instances', () => {
      expect(() => container.registerInstance('nullInstance', null)).not.toThrow();
      expect(() => container.registerInstance('undefinedInstance', undefined)).not.toThrow();

      expect(container.instances.get('nullInstance')).toBe(null);
      expect(container.instances.get('undefinedInstance')).toBe(undefined);
    });
  });

  describe('resolve', () => {
    it('should throw error for invalid token', () => {
      expect(() => container.resolve(123)).toThrow('Service token must be a string');
      expect(() => container.resolve(null)).toThrow('Service token must be a string');
    });

    it('should throw error for unregistered service', () => {
      expect(() => container.resolve('nonexistent')).toThrow("Service 'nonexistent' is not registered");
    });

    it('should resolve direct instances first', () => {
      const instance = { value: 'direct' };
      const factory = jest.fn().mockReturnValue({ value: 'factory' });

      container.registerInstance('testService', instance);
      container.register('testService', factory);

      const resolved = container.resolve('testService');
      expect(resolved).toBe(instance);
      expect(factory).not.toHaveBeenCalled();
    });

    it('should create and return singleton instances', () => {
      const instance = { value: 'singleton' };
      const factory = jest.fn().mockReturnValue(instance);

      container.registerSingleton('testService', factory);

      const resolved1 = container.resolve('testService');
      const resolved2 = container.resolve('testService');

      expect(resolved1).toBe(instance);
      expect(resolved2).toBe(instance);
      expect(resolved1).toBe(resolved2);
      expect(factory).toHaveBeenCalledTimes(1);
      expect(factory).toHaveBeenCalledWith(container);
    });

    it('should create new transient instances each time', () => {
      const instance1 = { value: 'transient1' };
      const instance2 = { value: 'transient2' };
      const factory = jest.fn().mockReturnValueOnce(instance1).mockReturnValueOnce(instance2);

      container.registerTransient('testService', factory);

      const resolved1 = container.resolve('testService');
      const resolved2 = container.resolve('testService');

      expect(resolved1).toBe(instance1);
      expect(resolved2).toBe(instance2);
      expect(resolved1).not.toBe(resolved2);
      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('should resolve dependencies and pass them to factory', () => {
      const dep1 = { name: 'dep1' };
      const dep2 = { name: 'dep2' };
      const mainService = { name: 'main' };

      container.registerInstance('dependency1', dep1);
      container.registerInstance('dependency2', dep2);

      const factory = jest.fn().mockReturnValue(mainService);
      container.register('mainService', factory, {
        dependencies: ['dependency1', 'dependency2'],
      });

      const resolved = container.resolve('mainService');

      expect(resolved).toBe(mainService);
      expect(factory).toHaveBeenCalledWith(container, dep1, dep2);
    });

    it('should handle nested dependency resolution', () => {
      const baseService = { name: 'base' };
      const midService = { name: 'mid' };
      const topService = { name: 'top' };

      container.registerInstance('baseService', baseService);

      container.register(
        'midService',
        (container, base) => {
          expect(base).toBe(baseService);
          return midService;
        },
        { dependencies: ['baseService'] }
      );

      container.register(
        'topService',
        (container, mid) => {
          expect(mid).toBe(midService);
          return topService;
        },
        { dependencies: ['midService'] }
      );

      const resolved = container.resolve('topService');
      expect(resolved).toBe(topService);
    });

    it('should throw error when factory returns undefined', () => {
      const factory = jest.fn().mockReturnValue(undefined);
      container.register('testService', factory);

      expect(() => container.resolve('testService')).toThrow("Factory for 'testService' returned undefined");
    });

    it('should wrap factory errors with context', () => {
      const factory = jest.fn().mockImplementation(() => {
        throw new Error('Factory error');
      });
      container.register('testService', factory);

      expect(() => container.resolve('testService')).toThrow(
        "Failed to create instance of 'testService': Factory error"
      );
    });
  });

  describe('isRegistered', () => {
    it('should return false for unregistered services', () => {
      expect(container.isRegistered('nonexistent')).toBe(false);
    });

    it('should return true for registered services', () => {
      container.register('testService', jest.fn());
      expect(container.isRegistered('testService')).toBe(true);
    });

    it('should return true for registered instances', () => {
      container.registerInstance('testInstance', {});
      expect(container.isRegistered('testInstance')).toBe(true);
    });

    it('should return true for both service and instance with same token', () => {
      container.register('testService', jest.fn());
      container.registerInstance('testService', {});
      expect(container.isRegistered('testService')).toBe(true);
    });
  });

  describe('getRegisteredTokens', () => {
    it('should return empty array when no services registered', () => {
      expect(container.getRegisteredTokens()).toEqual([]);
    });

    it('should return all registered service tokens', () => {
      container.register('service1', jest.fn());
      container.register('service2', jest.fn());
      container.registerInstance('instance1', {});

      const tokens = container.getRegisteredTokens();
      expect(tokens).toEqual(expect.arrayContaining(['service1', 'service2', 'instance1']));
      expect(tokens).toHaveLength(3);
    });

    it('should not duplicate tokens when service and instance have same name', () => {
      container.register('shared', jest.fn());
      container.registerInstance('shared', {});

      const tokens = container.getRegisteredTokens();
      expect(tokens).toEqual(['shared']);
      expect(tokens).toHaveLength(1);
    });
  });

  describe('createScope', () => {
    it('should create a new scoped container', () => {
      const scopedContainer = container.createScope();

      expect(scopedContainer).toBeInstanceOf(DependencyContainer);
      expect(scopedContainer).not.toBe(container);
      expect(scopedContainer.scoped).toBe(true);
    });

    it('should copy service registrations but not instances', () => {
      const factory = jest.fn().mockReturnValue({ value: 'test' });
      const instance = { value: 'test' };

      container.register('testService', factory);
      container.registerInstance('testInstance', instance);
      container.resolve('testService'); // Create singleton instance

      const scopedContainer = container.createScope();

      expect(scopedContainer.isRegistered('testService')).toBe(true);
      expect(scopedContainer.isRegistered('testInstance')).toBe(false);
      expect(scopedContainer.instances.size).toBe(0);

      const scopedService = scopedContainer.services.get('testService');
      expect(scopedService.factory).toBe(factory);
      expect(scopedService.initialized).toBe(false);
    });

    it('should create independent scoped instances', () => {
      const factory = jest.fn().mockReturnValueOnce({ id: 'parent' }).mockReturnValueOnce({ id: 'scoped' });

      container.registerSingleton('testService', factory);

      const parentInstance = container.resolve('testService');
      const scopedContainer = container.createScope();
      const scopedInstance = scopedContainer.resolve('testService');

      expect(parentInstance.id).toBe('parent');
      expect(scopedInstance.id).toBe('scoped');
      expect(parentInstance).not.toBe(scopedInstance);
    });
  });

  describe('clearInstances', () => {
    it('should clear all instances and reset initialization flags', () => {
      const factory = jest.fn().mockReturnValue({ value: 'test' });
      container.registerSingleton('testService', factory);
      container.registerInstance('testInstance', { value: 'instance' });

      // Create singleton instance
      container.resolve('testService');

      expect(container.instances.size).toBe(2);
      expect(container.services.get('testService').initialized).toBe(true);

      container.clearInstances();

      expect(container.instances.size).toBe(0);
      expect(container.services.get('testService').initialized).toBe(false);
    });

    it('should allow re-creation of singleton instances after clearing', () => {
      const factory = jest.fn().mockReturnValueOnce({ id: 'first' }).mockReturnValueOnce({ id: 'second' });

      container.registerSingleton('testService', factory);

      const first = container.resolve('testService');
      expect(first.id).toBe('first');

      container.clearInstances();

      const second = container.resolve('testService');
      expect(second.id).toBe('second');
      expect(first).not.toBe(second);
    });
  });

  describe('dispose', () => {
    it('should call dispose on instances that have dispose method', async () => {
      const disposable1 = { dispose: jest.fn() };
      const disposable2 = { dispose: jest.fn().mockResolvedValue(true) };
      const nonDisposable = { value: 'test' };

      container.registerInstance('disposable1', disposable1);
      container.registerInstance('disposable2', disposable2);
      container.registerInstance('nonDisposable', nonDisposable);

      await container.dispose();

      expect(disposable1.dispose).toHaveBeenCalledTimes(1);
      expect(disposable2.dispose).toHaveBeenCalledTimes(1);
      expect(container.instances.size).toBe(0);
    });

    it('should handle dispose errors gracefully', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const disposable = {
        dispose: jest.fn().mockImplementation(() => {
          throw new Error('Dispose error');
        }),
      };

      container.registerInstance('disposable', disposable);

      await expect(container.dispose()).resolves.not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error disposing instance:', expect.any(Error));

      consoleErrorSpy.mockRestore();
    });

    it('should wait for async dispose methods', async () => {
      let disposeComplete = false;
      const disposable = {
        dispose: jest.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          disposeComplete = true;
        }),
      };

      container.registerInstance('disposable', disposable);

      await container.dispose();

      expect(disposeComplete).toBe(true);
      expect(disposable.dispose).toHaveBeenCalledTimes(1);
    });

    it('should handle null and undefined instances', async () => {
      container.registerInstance('null', null);
      container.registerInstance('undefined', undefined);

      await expect(container.dispose()).resolves.not.toThrow();
    });
  });

  describe('validate', () => {
    it('should return true for valid container setup', () => {
      container.registerInstance('base', { name: 'base' });
      container.register('derived', jest.fn(), { dependencies: ['base'] });

      expect(container.validate()).toBe(true);
    });

    it('should detect circular dependencies', () => {
      container.register('serviceA', jest.fn(), { dependencies: ['serviceB'] });
      container.register('serviceB', jest.fn(), { dependencies: ['serviceA'] });

      expect(() => container.validate()).toThrow("Circular dependency detected involving 'serviceA'");
    });

    it('should detect deep circular dependencies', () => {
      container.register('serviceA', jest.fn(), { dependencies: ['serviceB'] });
      container.register('serviceB', jest.fn(), { dependencies: ['serviceC'] });
      container.register('serviceC', jest.fn(), { dependencies: ['serviceA'] });

      expect(() => container.validate()).toThrow("Circular dependency detected involving 'serviceA'");
    });

    it('should detect missing dependencies', () => {
      container.register('serviceA', jest.fn(), { dependencies: ['nonexistent'] });

      expect(() => container.validate()).toThrow("Dependency 'nonexistent' required by 'serviceA' is not registered");
    });

    it('should handle self-referencing dependencies', () => {
      container.register('serviceA', jest.fn(), { dependencies: ['serviceA'] });

      expect(() => container.validate()).toThrow("Circular dependency detected involving 'serviceA'");
    });

    it('should handle complex valid dependency graphs', () => {
      container.registerInstance('config', {});
      container.registerInstance('logger', {});
      container.register('database', jest.fn(), { dependencies: ['config'] });
      container.register('repository', jest.fn(), { dependencies: ['database', 'logger'] });
      container.register('service', jest.fn(), { dependencies: ['repository', 'config'] });

      expect(container.validate()).toBe(true);
    });

    it('should handle empty container', () => {
      expect(container.validate()).toBe(true);
    });

    it('should validate only service registrations, not instances', () => {
      container.registerInstance('orphanInstance', {});
      container.register('validService', jest.fn());

      expect(container.validate()).toBe(true);
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle factory that modifies container during creation', () => {
      const factory = jest.fn().mockImplementation(container => {
        // Factory tries to register another service during creation
        container.registerInstance('dynamicService', { name: 'dynamic' });
        return { name: 'created' };
      });

      container.register('testService', factory);

      const instance = container.resolve('testService');
      expect(instance.name).toBe('created');
      expect(container.isRegistered('dynamicService')).toBe(true);
    });

    it('should handle deeply nested dependency chains', () => {
      // Create a chain of 10 dependencies
      for (let i = 0; i < 10; i++) {
        const deps = i === 0 ? [] : [`service${i - 1}`];
        container.register(`service${i}`, (container, ...deps) => ({ id: i, deps }), {
          dependencies: deps,
        });
      }

      const result = container.resolve('service9');
      expect(result.id).toBe(9);
      expect(result.deps).toHaveLength(1);
    });

    it('should handle concurrent resolution of same singleton', () => {
      let creationCount = 0;
      const factory = jest.fn().mockImplementation(() => {
        creationCount++;
        return { id: creationCount };
      });

      container.registerSingleton('testService', factory);

      // Simulate concurrent access
      const instance1 = container.resolve('testService');
      const instance2 = container.resolve('testService');

      expect(instance1).toBe(instance2);
      expect(creationCount).toBe(1);
    });

    it('should maintain consistency after partial cleanup', () => {
      const factory = jest.fn().mockReturnValueOnce({ value: 'test1' }).mockReturnValueOnce({ value: 'test2' });
      container.registerSingleton('testService', factory);

      // Create instance
      const instance = container.resolve('testService');
      expect(container.instances.has('testService')).toBe(true);

      // Manually clear just the instances map (simulating partial cleanup)
      // This creates an inconsistent state where initialized=true but instance is gone
      container.instances.clear();

      // Should detect missing instance and create new one, even though initialized=true
      const newInstance = container.resolve('testService');
      expect(newInstance).not.toBe(instance);
      expect(newInstance.value).toBe('test2');
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });
});
