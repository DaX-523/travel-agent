// Middleware function to authenticate users
import jwt from "jsonwebtoken";
import { Request, Response } from "express";

export function authenticateToken(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  jwt.verify(
    token,
    process.env.JWT_SECRET || "default_jwt_secret",
    (err: any, user: any) => {
      if (err) {
        return res.status(403).json({ error: "Invalid or expired token" });
      }

      (req as any).user = user;
      next();
    }
  );
}
