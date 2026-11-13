import { Button, Input } from "antd";

import { NxLogo } from "@/components/NxIcon";

interface LockFormProps {
  name: string;
  error?: string;
  password: string;
  setPassword: (password: string) => void;
  unlocking: boolean;
  onUnlock: () => void;
}

/** A protected dashboard asks for its password. */
export function LockForm({ name, error, password, setPassword, unlocking, onUnlock }: LockFormProps) {
  return (
    <form
      className="nx-ra-panel nx-ra-public-lock"
      onSubmit={(event) => {
        event.preventDefault();
        onUnlock();
      }}
      data-testid="public-lock"
    >
      <NxLogo />
      <h1>{name}</h1>
      <p className="nx-ra-sub">This dashboard is protected. Enter the password you were given.</p>
      <Input.Password
        autoFocus
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Password"
        aria-label="Password"
        status={error ? "error" : undefined}
        data-testid="public-password"
      />
      {error && <p className="nx-ra-sub" style={{ color: "var(--nu-bad)", margin: "8px 0 0" }} role="alert">{error}</p>}
      <Button type="primary" htmlType="submit" block loading={unlocking} disabled={!password} style={{ marginTop: 12 }} data-testid="public-unlock">
        Open dashboard
      </Button>
    </form>
  );
}
