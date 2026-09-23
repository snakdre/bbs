import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-gold mb-1">Brice Beauty Supply</h1>
      <p className="text-sm text-muted mb-6">Sign in to continue</p>
      <LoginForm />
    </div>
  );
}
