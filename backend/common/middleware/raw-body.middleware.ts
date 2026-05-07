import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

// Extend Express Request to include rawBody
// This makes req.rawBody available with full TypeScript type safety
// throughout the application — no casting needed in the controller
declare global {
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}

@Injectable()
export class RawBodyMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void {
        const chunks: Buffer[] = [];

        req.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });

        req.on('end', () => {
            // Concatenate all chunks into a single Buffer
            // This is req.rawBody — the untouched bytes GitHub sent
            req.rawBody = Buffer.concat(chunks);

            // Now parse the raw bytes into JSON and attach to req.body
            // This replaces what body-parser would normally do
            // We do it manually here because we've consumed the stream
            try {
                if (req.rawBody.length > 0) {
                    req.body = JSON.parse(req.rawBody.toString('utf8'));
                }
            } catch {
                // If JSON parsing fails, leave req.body as-is
                // The controller will handle the malformed payload
                req.body = {};
            }

            next();
        });

        req.on('error', () => {
            // Stream error — let Express handle it
            next();
        });
    }
}