"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingSpinner } from "@/components/ui/loading";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.success) {
        router.push(redirect);
        router.refresh();
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-8">
      {/* Brand mark sits centred above the login box */}
      <div className="flex justify-center">
        <Image
          src="/Molten.png"
          alt="Molten Metal Pvt Ltd"
          width={183}
          height={100}
          priority
          className="h-20 w-auto object-contain"
        />
      </div>

      <div className="text-center lg:text-left">
        <h2 className="text-2xl font-bold text-[var(--foreground)]">
          Welcome back
        </h2>
        <p className="mt-2 text-[var(--muted-foreground)]">
          Sign in to your account to continue
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-[var(--error-light)] border border-[var(--error)] text-[var(--error)] text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--muted-foreground)]" />
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 pl-12 text-base"
              required
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--muted-foreground)]" />
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 pl-12 pr-12 text-base"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="cursor-pointer absolute right-4 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              {showPassword ? (
                <EyeOff className="h-5 w-5" />
              ) : (
                <Eye className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
            />
            <span className="text-sm text-[var(--muted-foreground)]">
              Remember me
            </span>
          </label>
          <Link
            href="/register"
            className="text-sm text-[var(--primary)] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full h-12 text-base" isLoading={isLoading}>
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-[var(--muted-foreground)]">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-[var(--primary)] hover:underline">
          Contact admin
        </Link>
      </p>
    </div>
  );
}

function LoginFormFallback() {
  return (
    <div className="w-full max-w-md flex items-center justify-center py-20">
      <LoadingSpinner size="lg" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Background Image */}
        <Image
          src="/mainLogin.jpg"
          alt="Glowing hot coals throwing off sparks"
          fill
          priority
          sizes="50vw"
          className="object-cover object-center"
        />
        {/* Overlay - stronger gradient for better text visibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/45" />

        {/* Content */}
        <div className="relative z-10 p-12 flex flex-col justify-center gap-10 w-full">
          <div className="space-y-4">
            <div className="bg-black/50 backdrop-blur-sm rounded-xl p-6 max-w-lg">
              <h1 className="text-4xl font-bold text-white leading-tight">
                Aluminum Casting
                <br />
                Inventory Management
              </h1>
              <p className="text-white/90 text-lg mt-4">
                Track ingots, manage scrap, monitor production, and analyze
                efficiency - all in one powerful platform.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-8 bg-black/50 backdrop-blur-sm rounded-xl p-5 w-fit">
            <div className="text-center">
              <p className="text-3xl font-bold text-white">99.9%</p>
              <p className="text-white/80 text-sm">Uptime</p>
            </div>
            <div className="w-px h-12 bg-white/30" />
            <div className="text-center">
              <p className="text-3xl font-bold text-white">50+</p>
              <p className="text-white/80 text-sm">Companies</p>
            </div>
            <div className="w-px h-12 bg-white/30" />
            <div className="text-center">
              <p className="text-3xl font-bold text-white">1M+</p>
              <p className="text-white/80 text-sm">Parts Tracked</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[var(--background)]">
        <Suspense fallback={<LoginFormFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
