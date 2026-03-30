export function getApiErrorMessage(error: unknown, fallback: string): string {
  const apiError = (error as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  })?.response?.data?.error;

  if (typeof apiError === 'string' && apiError.trim()) {
    return apiError;
  }

  if (apiError && typeof apiError === 'object') {
    const obj = apiError as { message?: unknown; code?: unknown };
    if (typeof obj.message === 'string' && obj.message.trim()) {
      return obj.message;
    }
    if (typeof obj.code === 'string' && obj.code.trim()) {
      return obj.code;
    }
  }

  const directMessage = (error as { message?: unknown })?.message;
  if (typeof directMessage === 'string' && directMessage.trim()) {
    return directMessage;
  }

  return fallback;
}
