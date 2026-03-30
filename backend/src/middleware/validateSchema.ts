import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { sendError } from '../utils/errors';

/**
 * Middleware factory que valida req.body contra un ZodSchema.
 * Si la validación pasa, sustituye req.body por el resultado parseado (coerced/defaulted).
 * Si falla, retorna 400 con los mensajes de error formateados.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                const messages = error.errors
                    .map(e => `${e.path.length ? e.path.join('.') + ': ' : ''}${e.message}`)
                    .join('; ');
                sendError(res, 400, 'VALIDATION_ERROR', messages);
                return;
            }
            next(error);
        }
    };
}
