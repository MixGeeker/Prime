import type { InputsBuilderOptions, ModuleResolver } from './types.js';

type RegisteredResolver<TContext> = {
  name: string;
  resolve: ModuleResolver<TContext>;
};

export class InputsConflictError extends Error {
  constructor(
    key: string,
    previousResolver: string,
    nextResolver: string,
  ) {
    super(`inputs key conflict: ${key} (${previousResolver} -> ${nextResolver})`);
    this.name = 'InputsConflictError';
  }
}

export class InputsBuilder<TContext> {
  private readonly resolvers: RegisteredResolver<TContext>[] = [];
  private readonly conflictStrategy: 'throw' | 'overwrite';

  constructor(options?: InputsBuilderOptions) {
    this.conflictStrategy = options?.conflictStrategy ?? 'throw';
  }

  use(name: string, resolve: ModuleResolver<TContext>): this {
    const normalized = name.trim();
    if (!normalized) {
      throw new Error('resolver name is required');
    }
    this.resolvers.push({ name: normalized, resolve });
    return this;
  }

  async build(context: TContext): Promise<Record<string, unknown>> {
    const inputs: Record<string, unknown> = {};
    const owners = new Map<string, string>();

    for (const resolver of this.resolvers) {
      const partial = await resolver.resolve(context);
      if (partial == null) continue;
      if (!isPlainObject(partial)) {
        throw new Error(`resolver must return an object: ${resolver.name}`);
      }

      for (const [key, value] of Object.entries(partial)) {
        const previousOwner = owners.get(key);
        if (previousOwner && this.conflictStrategy === 'throw') {
          throw new InputsConflictError(key, previousOwner, resolver.name);
        }
        inputs[key] = value;
        owners.set(key, resolver.name);
      }
    }

    return inputs;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
