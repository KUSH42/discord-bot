/**
 * Dependency Injection Container for managing service dependencies
 */
export class DependencyContainer {
  constructor() {
    this.services = new Map();
    this.instances = new Map();
    this.scoped = false;
  }

  /**
   * Register a service with a factory function
   * @param {string} token - Service identifier
   * @param {Function} factory - Factory function that creates the service
   * @param {Object} options - Registration options
   */
  register(token, factory, options = {}) {
    if (typeof token !== 'string') {
      throw new Error('Service token must be a string');
    }

    if (typeof factory !== 'function') {
      throw new Error('Service factory must be a function');
    }

    this.services.set(token, {
      factory,
      singleton: options.singleton !== false, // Default to singleton
      dependencies: options.dependencies || [],
      initialized: false,
    });

    return this;
  }

  /**
   * Register a singleton service (same as register with singleton: true)
   */
  registerSingleton(token, factory, options = {}) {
    return this.register(token, factory, { ...options, singleton: true });
  }

  /**
   * Register a transient service (new instance each time)
   */
  registerTransient(token, factory, options = {}) {
    return this.register(token, factory, { ...options, singleton: false });
  }

  /**
   * Register an instance directly
   */
  registerInstance(token, instance) {
    if (typeof token !== 'string') {
      throw new Error('Service token must be a string');
    }

    this.instances.set(token, instance);
    return this;
  }

  /**
   * Resolve a service by token
   * @param {string} token - Service identifier
   * @returns {*} The service instance
   */
  resolve(token) {
    if (typeof token !== 'string') {
      throw new Error('Service token must be a string');
    }

    // Check for direct instance first
    if (this.instances.has(token)) {
      return this.instances.get(token);
    }

    // Check for registered service
    if (!this.services.has(token)) {
      throw new Error(`Service '${token}' is not registered`);
    }

    const service = this.services.get(token);

    // Return existing singleton instance if available
    if (service.singleton && service.initialized && this.instances.has(token)) {
      return this.instances.get(token);
    }

    // Create new instance
    const instance = this.createInstance(token, service);

    // Store singleton instance
    if (service.singleton) {
      this.instances.set(token, instance);
      service.initialized = true;
    }

    return instance;
  }

  /**
   * Create a new instance using the factory
   */
  createInstance(token, service) {
    try {
      // Resolve dependencies
      const resolvedDependencies = service.dependencies.map(dep => this.resolve(dep));

      // Call factory with dependencies
      const instance = service.factory(this, ...resolvedDependencies);

      if (instance === undefined) {
        throw new Error(`Factory for '${token}' returned undefined`);
      }

      return instance;
    } catch (error) {
      throw new Error(`Failed to create instance of '${token}': ${error.message}`);
    }
  }

  /**
   * Check if a service is registered
   */
  isRegistered(token) {
    return this.services.has(token) || this.instances.has(token);
  }

  /**
   * Get all registered service tokens
   */
  getRegisteredTokens() {
    return [...new Set([...this.services.keys(), ...this.instances.keys()])];
  }

  /**
   * Create a scoped container for testing
   */
  createScope() {
    const scopedContainer = new DependencyContainer();
    scopedContainer.scoped = true;

    // Copy service registrations (but not instances)
    for (const [token, service] of this.services.entries()) {
      scopedContainer.services.set(token, { ...service, initialized: false });
    }

    return scopedContainer;
  }

  /**
   * Clear all instances (useful for testing)
   */
  clearInstances() {
    this.instances.clear();

    // Reset initialization flags
    for (const service of this.services.values()) {
      service.initialized = false;
    }
  }

  /**
   * Dispose of all instances that have a dispose method
   */
  async dispose() {
    const disposePromises = [];

    for (const instance of this.instances.values()) {
      if (instance && typeof instance.dispose === 'function') {
        try {
          const result = instance.dispose();
          if (result && typeof result.then === 'function') {
            disposePromises.push(result);
          }
        } catch (error) {
          console.error('Error disposing instance:', error);
        }
      }
    }

    await Promise.all(disposePromises);
    this.clearInstances();
  }

  /**
   * Validate container setup (check for circular dependencies)
   */
  validate() {
    const visited = new Set();
    const visiting = new Set();

    const visitService = token => {
      if (visiting.has(token)) {
        throw new Error(`Circular dependency detected involving '${token}'`);
      }

      if (visited.has(token)) {
        return;
      }

      visiting.add(token);

      const service = this.services.get(token);
      if (service && service.dependencies) {
        for (const dep of service.dependencies) {
          if (!this.isRegistered(dep)) {
            throw new Error(`Dependency '${dep}' required by '${token}' is not registered`);
          }
          visitService(dep);
        }
      }

      visiting.delete(token);
      visited.add(token);
    };

    for (const token of this.services.keys()) {
      visitService(token);
    }

    return true;
  }
}
