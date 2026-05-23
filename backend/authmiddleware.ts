import type {Request,Response,NextFunction} from 'express';
import jwt from 'jsonwebtoken';

interface AuthenticatedRequest extends Request {
  userId?: number;
}

interface JwtPayload {
  userId: number;
}

function authmiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = req.headers.token as string;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const secretKey: string = process.env.JWT_SECRET as string;
  const decoded = jwt.verify(token, secretKey) as JwtPayload;
  const userId = decoded.userId;
  if(userId){
    req.userId = userId;
    next();
  }
  else{
    res.status(401).json({
      message:'incorrect token recieved'
     });
    return;
  }
}

export default authmiddleware;