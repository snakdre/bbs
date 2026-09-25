import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function NotAuthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-gold mb-2">Not authorized</h1>
        <p className="text-muted mb-6">
          Your account doesn&apos;t have permission to view that page.
        </p>
        <Link href="/dashboard">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
