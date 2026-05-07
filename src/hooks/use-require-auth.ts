import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "../components/AuthProvider";

export function useRequireAuth() {
  const auth = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!auth.loading && !auth.user) {
      void navigate({ to: "/login" });
    }
  }, [auth.loading, auth.user, navigate]);

  return auth;
}
