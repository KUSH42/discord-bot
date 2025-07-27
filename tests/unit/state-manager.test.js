import { jest } from '@jest/globals';
import { StateManager } from '../../src/infrastructure/state-manager.js';
import { timestampUTC } from '../../src/utilities/utc-time.js';

const flushPromises = async () => {
  await Promise.resolve();
  // Also wait for setImmediate callbacks
  await new Promise(resolve => setImmediate(resolve));
};

describe('StateManager', () => {
  let stateManager;
  let mockCallback1;
  let mockCallback2;

  beforeEach(() => {
    stateManager = new StateManager({ initialKey: 'initialValue' });
    mockCallback1 = jest.fn();
    mockCallback2 = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with provided initial state', () => {
      const initialState = { key1: 'value1', key2: 42 };
      const manager = new StateManager(initialState);

      expect(manager.get('key1')).toBe('value1');
      expect(manager.get('key2')).toBe(42);
      expect(manager.locked).toBe(false);
    });

    it('should initialize with empty state when no initial state provided', () => {
      const manager = new StateManager();
      expect(manager.getKeys()).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('should retrieve existing state value', () => {
      expect(stateManager.get('initialKey')).toBe('initialValue');
    });

    it('should return default value for non-existent key', () => {
      expect(stateManager.get('nonExistent', 'default')).toBe('default');
    });

    it('should return undefined for non-existent key without default', () => {
      expect(stateManager.get('nonExistent')).toBeUndefined();
    });

    it('should throw error for non-string key', () => {
      expect(() => stateManager.get(123)).toThrow('State key must be a string');
      expect(() => stateManager.get(null)).toThrow('State key must be a string');
    });
  });

  describe('set', () => {
    it('should set new state value', () => {
      const result = stateManager.set('newKey', 'newValue');

      expect(result).toBe(true);
      expect(stateManager.get('newKey')).toBe('newValue');
    });

    it('should update existing state value', () => {
      stateManager.set('initialKey', 'updatedValue');
      expect(stateManager.get('initialKey')).toBe('updatedValue');
    });

    it('should throw error for non-string key', () => {
      expect(() => stateManager.set(123, 'value')).toThrow('State key must be a string');
    });

    it('should throw error when locked', () => {
      stateManager.lock();
      expect(() => stateManager.set('key', 'value')).toThrow('StateManager is locked and cannot be modified');
    });

    it('should validate value using validator', () => {
      const validator = jest.fn(value => {
        return typeof value === 'string' ? true : 'Value must be a string';
      });

      stateManager.setValidator('testKey', validator);

      expect(() => stateManager.set('testKey', 123)).toThrow(
        "Validation failed for key 'testKey': Value must be a string"
      );
      expect(stateManager.set('testKey', 'validString')).toBe(true);
      expect(validator).toHaveBeenCalledWith(123, undefined);
      expect(validator).toHaveBeenCalledWith('validString', undefined);
    });

    it('should not notify subscribers when value unchanged', async () => {
      stateManager.subscribe('testKey', mockCallback1);
      stateManager.set('testKey', 'value');
      stateManager.set('testKey', 'value'); // Same value

      // Wait for async callbacks
      await flushPromises();
      expect(mockCallback1).toHaveBeenCalledTimes(1);
    });

    it('should notify subscribers when value changes', async () => {
      stateManager.set('testKey', 'oldValue');
      stateManager.subscribe('testKey', mockCallback1);
      stateManager.set('testKey', 'newValue');

      await flushPromises();
      expect(mockCallback1).toHaveBeenCalledWith('newValue', 'oldValue', 'testKey');
    });
  });

  describe('update', () => {
    it('should update multiple values atomically', () => {
      const updates = {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      };

      stateManager.update(updates);

      expect(stateManager.get('key1')).toBe('value1');
      expect(stateManager.get('key2')).toBe('value2');
      expect(stateManager.get('key3')).toBe('value3');
    });

    it('should throw error for non-object updates', () => {
      expect(() => stateManager.update('not-object')).toThrow('Updates must be an object');
      expect(() => stateManager.update(null)).toThrow('Updates must be an object');
    });

    it('should throw error when locked', () => {
      stateManager.lock();
      expect(() => stateManager.update({ key: 'value' })).toThrow('StateManager is locked and cannot be modified');
    });

    it('should validate all updates before applying any', () => {
      const validator = jest.fn(value => {
        return value !== 'invalid' ? true : 'Value is invalid';
      });

      stateManager.setValidator('validatedKey', validator);

      const updates = {
        validatedKey: 'invalid',
        otherKey: 'value',
      };

      expect(() => stateManager.update(updates)).toThrow("Validation failed for key 'validatedKey': Value is invalid");
      expect(stateManager.get('otherKey')).toBeUndefined(); // Should not be set
    });

    it('should notify subscribers of all changes', () => {
      stateManager.set('key1', 'oldValue1');
      stateManager.set('key2', 'oldValue2');

      stateManager.subscribe('key1', mockCallback1);
      stateManager.subscribe('key2', mockCallback2);

      stateManager.update({
        key1: 'newValue1',
        key2: 'newValue2',
        key3: 'newValue3',
      });

      return new Promise(resolve =>
        setImmediate(() => {
          expect(mockCallback1).toHaveBeenCalledWith('newValue1', 'oldValue1', 'key1');
          expect(mockCallback2).toHaveBeenCalledWith('newValue2', 'oldValue2', 'key2');
          resolve();
        })
      );
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      expect(stateManager.has('initialKey')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(stateManager.has('nonExistent')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing key', () => {
      const result = stateManager.delete('initialKey');

      expect(result).toBe(true);
      expect(stateManager.has('initialKey')).toBe(false);
    });

    it('should return false for non-existent key', () => {
      const result = stateManager.delete('nonExistent');
      expect(result).toBe(false);
    });

    it('should throw error for non-string key', () => {
      expect(() => stateManager.delete(123)).toThrow('State key must be a string');
    });

    it('should throw error when locked', () => {
      stateManager.lock();
      expect(() => stateManager.delete('initialKey')).toThrow('StateManager is locked and cannot be modified');
    });

    it('should notify subscribers when key is deleted', async () => {
      stateManager.subscribe('initialKey', mockCallback1);
      stateManager.delete('initialKey');

      await flushPromises();
      expect(mockCallback1).toHaveBeenCalledWith(undefined, 'initialValue', 'initialKey');
    });
  });

  describe('subscribe', () => {
    it('should register subscriber for key changes', () => {
      const unsubscribe = stateManager.subscribe('testKey', mockCallback1);

      expect(typeof unsubscribe).toBe('function');
      expect(stateManager.subscribers.has('testKey')).toBe(true);
      expect(stateManager.subscribers.get('testKey')).toContain(mockCallback1);
    });

    it('should throw error for invalid key', () => {
      expect(() => stateManager.subscribe(123, mockCallback1)).toThrow('State key must be a string');
    });

    it('should throw error for invalid callback', () => {
      expect(() => stateManager.subscribe('testKey', 'not-function')).toThrow('Callback must be a function');
    });

    it('should support multiple subscribers for same key', () => {
      stateManager.subscribe('testKey', mockCallback1);
      stateManager.subscribe('testKey', mockCallback2);

      const subscribers = stateManager.subscribers.get('testKey');
      expect(subscribers).toHaveLength(2);
      expect(subscribers).toContain(mockCallback1);
      expect(subscribers).toContain(mockCallback2);
    });

    it('should return working unsubscribe function', async () => {
      const unsubscribe = stateManager.subscribe('testKey', mockCallback1);
      stateManager.set('testKey', 'value1');
      await flushPromises();

      // Verify first call happened
      expect(mockCallback1).toHaveBeenCalledTimes(1);

      unsubscribe();
      stateManager.set('testKey', 'value2');
      await flushPromises();

      // Should still be 1 (no new calls after unsubscribe)
      expect(mockCallback1).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('should remove specific subscriber', () => {
      stateManager.subscribe('testKey', mockCallback1);
      stateManager.subscribe('testKey', mockCallback2);

      stateManager.unsubscribe('testKey', mockCallback1);

      const subscribers = stateManager.subscribers.get('testKey');
      expect(subscribers).toHaveLength(1);
      expect(subscribers).toContain(mockCallback2);
      expect(subscribers).not.toContain(mockCallback1);
    });

    it('should clean up empty subscriber arrays', () => {
      stateManager.subscribe('testKey', mockCallback1);
      stateManager.unsubscribe('testKey', mockCallback1);

      expect(stateManager.subscribers.has('testKey')).toBe(false);
    });

    it('should handle unsubscribing non-existent key gracefully', () => {
      stateManager.unsubscribe('nonExistent', mockCallback1);
      // Should not throw
    });

    it('should handle unsubscribing non-existent callback gracefully', () => {
      stateManager.subscribe('testKey', mockCallback1);
      stateManager.unsubscribe('testKey', mockCallback2);

      expect(stateManager.subscribers.get('testKey')).toContain(mockCallback1);
    });
  });

  describe('setValidator', () => {
    it('should set validator for key', () => {
      const validator = jest.fn(() => true);
      stateManager.setValidator('testKey', validator);

      expect(stateManager.validators.has('testKey')).toBe(true);
      expect(stateManager.validators.get('testKey')).toBe(validator);
    });

    it('should throw error for invalid key', () => {
      expect(() => stateManager.setValidator(123, jest.fn())).toThrow('State key must be a string');
    });

    it('should throw error for invalid validator', () => {
      expect(() => stateManager.setValidator('testKey', 'not-function')).toThrow('Validator must be a function');
    });
  });

  describe('removeValidator', () => {
    it('should remove validator for key', () => {
      stateManager.setValidator('testKey', jest.fn());
      stateManager.removeValidator('testKey');

      expect(stateManager.validators.has('testKey')).toBe(false);
    });
  });

  describe('getKeys', () => {
    it('should return all state keys', () => {
      stateManager.set('key1', 'value1');
      stateManager.set('key2', 'value2');

      const keys = stateManager.getKeys();
      expect(keys).toHaveLength(3); // Including initialKey
      expect(keys).toContain('initialKey');
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });
  });

  describe('getAll', () => {
    it('should return copy of all state', () => {
      stateManager.set('key1', 'value1');

      const allState = stateManager.getAll();

      expect(allState).toEqual({
        initialKey: 'initialValue',
        key1: 'value1',
      });

      // Verify it's a copy
      allState.newKey = 'newValue';
      expect(stateManager.has('newKey')).toBe(false);
    });
  });

  describe('reset', () => {
    beforeEach(() => {
      stateManager.set('key1', 'value1');
      stateManager.set('key2', 'value2');
    });

    it('should reset to empty state when no argument provided', () => {
      stateManager.reset();

      expect(stateManager.getKeys()).toHaveLength(0);
    });

    it('should reset to provided state', () => {
      const newState = { newKey: 'newValue' };
      stateManager.reset(newState);

      expect(stateManager.get('newKey')).toBe('newValue');
      expect(stateManager.has('initialKey')).toBe(false);
    });

    it('should throw error when locked', () => {
      stateManager.lock();
      expect(() => stateManager.reset()).toThrow('StateManager is locked and cannot be modified');
    });

    it('should notify subscribers of all changes', () => {
      stateManager.subscribe('initialKey', mockCallback1);
      stateManager.subscribe('key1', mockCallback2);

      stateManager.reset({ newKey: 'newValue' });

      return new Promise(resolve =>
        setImmediate(() => {
          expect(mockCallback1).toHaveBeenCalledWith(undefined, 'initialValue', 'initialKey');
          expect(mockCallback2).toHaveBeenCalledWith(undefined, 'value1', 'key1');
          resolve();
        })
      );
    });
  });

  describe('lock/unlock', () => {
    it('should lock state manager', () => {
      stateManager.lock();
      expect(stateManager.isLocked()).toBe(true);
    });

    it('should unlock state manager', () => {
      stateManager.lock();
      stateManager.unlock();
      expect(stateManager.isLocked()).toBe(false);
    });

    it('should prevent modifications when locked', () => {
      stateManager.lock();

      expect(() => stateManager.set('key', 'value')).toThrow('StateManager is locked and cannot be modified');
      expect(() => stateManager.update({ key: 'value' })).toThrow('StateManager is locked and cannot be modified');
      expect(() => stateManager.delete('initialKey')).toThrow('StateManager is locked and cannot be modified');
      expect(() => stateManager.reset()).toThrow('StateManager is locked and cannot be modified');
    });

    it('should allow reads when locked', () => {
      stateManager.lock();

      expect(() => stateManager.get('initialKey')).not.toThrow();
      expect(() => stateManager.has('initialKey')).not.toThrow();
      expect(() => stateManager.getAll()).not.toThrow();
    });
  });

  describe('createSnapshot', () => {
    it('should create snapshot with state and metadata', () => {
      stateManager.set('key1', 'value1');
      stateManager.subscribe('key1', mockCallback1);
      stateManager.setValidator('key1', jest.fn());

      const snapshot = stateManager.createSnapshot();

      expect(snapshot.state).toEqual({
        initialKey: 'initialValue',
        key1: 'value1',
      });
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.subscriberCount).toBe(1);
      expect(snapshot.validatorCount).toBe(1);
    });
  });

  describe('restoreSnapshot', () => {
    it('should restore state from snapshot', () => {
      const snapshot = {
        state: { restoredKey: 'restoredValue' },
        timestamp: timestampUTC(),
        subscriberCount: 0,
        validatorCount: 0,
      };

      stateManager.restoreSnapshot(snapshot);

      expect(stateManager.get('restoredKey')).toBe('restoredValue');
      expect(stateManager.has('initialKey')).toBe(false);
    });

    it('should throw error for invalid snapshot', () => {
      expect(() => stateManager.restoreSnapshot(null)).toThrow('Invalid snapshot');
      expect(() => stateManager.restoreSnapshot('not-object')).toThrow('Invalid snapshot');
    });
  });

  describe('notifySubscribers', () => {
    it('should handle subscriber errors gracefully', () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Subscriber error');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      stateManager.subscribe('testKey', errorCallback);
      stateManager.subscribe('testKey', mockCallback1);

      stateManager.set('testKey', 'value');

      return new Promise(resolve =>
        setImmediate(() => {
          expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("Subscriber error for key 'testKey'"),
            expect.any(Error)
          );
          expect(mockCallback1).toHaveBeenCalled();
          consoleSpy.mockRestore();
          resolve();
        })
      );
    });

    it('should execute callbacks asynchronously', () => {
      let callbackExecuted = false;
      const asyncCallback = jest.fn(() => {
        callbackExecuted = true;
      });

      stateManager.subscribe('testKey', asyncCallback);
      stateManager.set('testKey', 'value');

      // Callback should not be executed synchronously
      expect(callbackExecuted).toBe(false);

      return new Promise(resolve =>
        setImmediate(() => {
          expect(callbackExecuted).toBe(true);
          resolve();
        })
      );
    });
  });

  describe('getStats', () => {
    it('should return state manager statistics', () => {
      stateManager.set('key1', 'value1');
      stateManager.subscribe('key1', mockCallback1);
      stateManager.subscribe('initialKey', mockCallback2);
      stateManager.setValidator('key1', jest.fn());

      const stats = stateManager.getStats();

      expect(stats.stateKeys).toBe(2);
      expect(stats.subscriberCount).toBe(2);
      expect(stats.validatorCount).toBe(1);
      expect(stats.locked).toBe(false);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('should return correct stats for locked state manager', () => {
      stateManager.lock();
      const stats = stateManager.getStats();

      expect(stats.locked).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle validator that receives old value', () => {
      const validator = jest.fn((newValue, oldValue) => {
        return newValue !== oldValue ? true : 'Value must be different';
      });

      stateManager.setValidator('testKey', validator);
      stateManager.set('testKey', 'value1');

      expect(() => stateManager.set('testKey', 'value1')).toThrow(
        "Validation failed for key 'testKey': Value must be different"
      );
      expect(validator).toHaveBeenCalledWith('value1', 'value1');
    });

    it('should handle rapid state changes', async () => {
      let changeCount = 0;
      const callback = jest.fn(() => changeCount++);

      stateManager.subscribe('rapidKey', callback);

      for (let i = 0; i < 100; i++) {
        stateManager.set('rapidKey', `value-${i}`);
      }

      await flushPromises();
      await flushPromises();
      expect(callback).toHaveBeenCalledTimes(100);
    });

    it('should handle callbacks that unsubscribe themselves', async () => {
      let unsubscribe;
      const selfUnsubscribingCallback = jest.fn(() => {
        unsubscribe();
      });

      unsubscribe = stateManager.subscribe('testKey', selfUnsubscribingCallback);
      stateManager.subscribe('testKey', mockCallback1);

      stateManager.set('testKey', 'value1');
      stateManager.set('testKey', 'value2');

      // Wait for async callbacks to execute
      await flushPromises();

      expect(selfUnsubscribingCallback).toHaveBeenCalledTimes(1);
      expect(mockCallback1).toHaveBeenCalledTimes(2);
    });
  });
});
