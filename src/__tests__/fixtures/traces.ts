import type { TraceRecord } from "../../lib/types.js";

export const sampleTraces: TraceRecord[] = [
  {
    version: "1.0.0",
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    timestamp: "2026-01-23T06:30:00Z",
    vcs: {
      type: "git",
      revision: "8a4f2b1c9d3e7f6a5b4c3d2e1f0a9b8c7d6e5f4",
    },
    tool: {
      name: "cursor",
      version: "2.4.1",
    },
    files: [
      {
        path: "src/api/auth/middleware.ts",
        conversations: [
          {
            url: "https://api.cursor.com/v1/conversations/12345",
            contributor: {
              type: "ai",
              model_id: "anthropic/claude-sonnet-4-20250514",
            },
            ranges: [
              { start_line: 1, end_line: 50 },
              { start_line: 52, end_line: 100 },
            ],
          },
          {
            contributor: {
              type: "ai",
              model_id: "openai/gpt-4o",
            },
            ranges: [{ start_line: 101, end_line: 150 }],
          },
        ],
      },
      {
        path: "src/api/auth/jwt.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "openai/gpt-4o",
            },
            ranges: [
              { start_line: 1, end_line: 80 },
              { start_line: 82, end_line: 120 },
            ],
          },
        ],
      },
      {
        path: "src/api/auth/__tests__/middleware.test.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "anthropic/claude-sonnet-4-20250514",
            },
            ranges: [{ start_line: 1, end_line: 60 }],
          },
        ],
      },
    ],
    metadata: {
      scenario: "Cursor multi-turn refactoring",
      confidence: 0.97,
      post_processing_tools: ["prettier@3.4.0", "eslint@9.0.0"],
    },
  },
  {
    version: "1.0.0",
    id: "b2c3d4e5-f6a7-8901-bcde-f23456789012",
    timestamp: "2026-01-22T01:15:00Z",
    vcs: {
      type: "git",
      revision: "7b3e1c2d8e4f7a6b5c4d3e2f1a0b9c8d7e6f5a4",
    },
    tool: {
      name: "cursor",
      version: "2.4.0",
    },
    files: [
      {
        path: "src/api/webhooks/stripe.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "anthropic/claude-opus-4-5-20251101",
            },
            ranges: [{ start_line: 1, end_line: 120 }],
          },
        ],
      },
      {
        path: "src/api/webhooks/handlers.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "anthropic/claude-opus-4-5-20251101",
            },
            ranges: [{ start_line: 1, end_line: 80 }],
          },
        ],
      },
      {
        path: "src/api/webhooks/__tests__/stripe.test.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "anthropic/claude-opus-4-5-20251101",
            },
            ranges: [{ start_line: 1, end_line: 90 }],
          },
        ],
      },
    ],
    metadata: {
      scenario: "Stripe webhook bug fix",
      issue: "PAY-291",
    },
  },
  {
    version: "1.0.0",
    id: "c3d4e5f6-a7b8-9012-cdef-345678901234",
    timestamp: "2026-01-21T08:45:00Z",
    vcs: {
      type: "git",
      revision: "6c2d0b1e7d3f6a5b4c3d2e1f0a9b8c7d6e5f4a3",
    },
    tool: {
      name: "cursor",
      version: "2.4.0",
    },
    files: [
      {
        path: "src/components/dashboard/Analytics.tsx",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "openai/gpt-4o",
            },
            ranges: [{ start_line: 1, end_line: 150 }],
          },
        ],
      },
      {
        path: "src/components/dashboard/Charts.tsx",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "openai/gpt-4o",
            },
            ranges: [{ start_line: 1, end_line: 100 }],
          },
        ],
      },
      {
        path: "src/hooks/useAnalytics.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "openai/o3-mini",
            },
            ranges: [{ start_line: 1, end_line: 80 }],
          },
        ],
      },
      {
        path: "src/api/analytics.ts",
        conversations: [
          {
            contributor: {
              type: "ai",
              model_id: "openai/gpt-4o",
            },
            ranges: [{ start_line: 1, end_line: 120 }],
          },
        ],
      },
    ],
    metadata: {
      scenario: "Analytics dashboard feature",
    },
  },
];

export const sampleCodeFiles: Record<string, string> = {
  "src/api/auth/middleware.ts": `import { Request, Response, NextFunction } from 'express';
import { RateLimiter } from './rate-limiter';
import { verifyToken } from './jwt';

export class AuthMiddleware {
  private rateLimiter: RateLimiter;

  constructor() {
    this.rateLimiter = new RateLimiter({
      windowMs: 60_000, // 60 seconds
      maxRequests: 100,
    });
  }

  async authenticate(req: Request, res: Response, next: NextFunction) {
    // Rate limit check
    const rateLimitResult = await this.rateLimiter.check(req.ip);
    if (!rateLimitResult.allowed) {
      return res.status(429).json({ 
        error: 'Too many requests',
        retryAfter: rateLimitResult.retryAfter 
      });
    }

    // Extract token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing auth token' });
    }

    const token = authHeader.substring(7);

    try {
      // Verify JWT token
      const payload = await verifyToken(token, {
        algorithms: ['RS256'],
        issuer: 'https://api.example.com',
        audience: 'https://app.example.com',
      });

      req.user = payload;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }
}`,
  "src/api/auth/jwt.ts": `import jwt from 'jsonwebtoken';
import { RateLimiter } from './rate-limiter';

export interface AuthConfig {
  publicKey: string;
  issuer: string;
  audience: string;
}

export class AuthService {
  private rateLimiter: RateLimiter;
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
    this.rateLimiter = new RateLimiter({
      windowMs: 60_000,
      maxRequests: 100,
    });
  }

  async verifyToken(token: string, options?: jwt.VerifyOptions): Promise<jwt.JwtPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(
        token,
        this.config.publicKey,
        {
          algorithms: ['RS256'],
          issuer: this.config.issuer,
          audience: this.config.audience,
          ...options,
        },
        (err, decoded) => {
          if (err) {
            reject(err);
          } else {
            resolve(decoded as jwt.JwtPayload);
          }
        }
      );
    });
  }
}

export async function verifyToken(
  token: string,
  options?: jwt.VerifyOptions
): Promise<jwt.JwtPayload> {
  const service = new AuthService({
    publicKey: process.env.JWT_PUBLIC_KEY!,
    issuer: 'https://api.example.com',
    audience: 'https://app.example.com',
  });
  return service.verifyToken(token, options);
}`,
  "src/api/auth/__tests__/middleware.test.ts": `import { Request, Response, NextFunction } from 'express';
import { verify, JwtPayload } from 'jsonwebtoken';
import { AuthMiddleware } from '../middleware';

describe('AuthMiddleware', () => {
  let middleware: AuthMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    middleware = new AuthMiddleware();
    mockRequest = {
      headers: {},
      ip: '127.0.0.1',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  it('should reject requests without auth token', async () => {
    await middleware.authenticate(
      mockRequest as Request,
      mockResponse as Response,
      mockNext
    );

    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: 'Missing auth token' });
  });
});`,
};
