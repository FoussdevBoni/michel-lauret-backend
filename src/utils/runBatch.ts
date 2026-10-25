import { z, ZodError } from 'zod';

export async function runBatch<Input, Output>(
  input: unknown,
  execute: (item: Input) => Promise<Output>,
) {
  const items = z.array(z.unknown()).min(1).max(100).parse(input) as Input[];
  const success: Output[] = [];
  const errors: { index: number; message: string }[] = [];
  for (const [index, item] of items.entries()) {
    try {
      success.push(await execute(item));
    } catch (error) {
      errors.push({
        index,
        message:
          error instanceof ZodError
            ? error.issues[0].message
            : typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === 11000
              ? 'Une valeur devant être unique est déjà utilisée.'
              : error instanceof Error
                ? error.message
                : 'L’opération a échoué.',
      });
    }
  }
  return { success, errors, totalAttempted: items.length };
}
