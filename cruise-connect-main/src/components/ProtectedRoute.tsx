import { Navigate, useLocation } from "react-router-dom";
import { useApp } from "@/context/AppContext";

interface ProtectedRouteProps {
    children: React.ReactNode;
    allowedRoles: Array<"CLIENT" | "DRIVER" | "ADMIN">;
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
    const { role, token } = useApp();
    const location = useLocation();

    if (!token) {
        return <Navigate to="/" state={{ from: location }} replace />;
    }

    if (role && !allowedRoles.includes(role)) {
        const redirectPath = role === "ADMIN" ? "/admin" : (role === "CLIENT" ? "/client" : "/driver");
        return <Navigate to={redirectPath} replace />;
    }

    return <>{children}</>;
}
