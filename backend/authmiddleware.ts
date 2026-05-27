import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "shared/generated/prisma/enums";

interface AuthenticatedRequest extends Request {
  userId?: number;
  role?: Role;
}

interface JwtPayload {
  userId: number;
}

interface jwtPayloadWithRole extends JwtPayload {
  role: Role;
}

const authmiddleware = (role?: Role) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = req.headers.token as string;
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const secretKey: string = process.env.JWT_SECRET as string;
      const decoded = jwt.verify(token, secretKey) as jwtPayloadWithRole;
      const userRole = decoded.role;
      const userId = decoded.userId;
      if (role && userRole !== role) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      if (userId) {
        req.userId = userId;
        req.role = userRole;
        next();
      } else {
        res.status(401).json({
          message: "incorrect token recieved",
        });
        return;
      }
    } catch (error) {
      res.status(401).json({ error: "Invalid or expired token" });
    }
  };
};

export default authmiddleware;
