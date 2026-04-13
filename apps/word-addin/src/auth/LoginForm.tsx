import React, { useState } from "react";
import {
  Input,
  Button,
  Field,
  Spinner,
  MessageBar,
  MessageBarBody,
  Title3,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { trpcCall, setTokens } from "../api";
import { useAuth } from "./AuthProvider";

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    padding: "24px 16px",
    gap: "16px",
    maxWidth: "320px",
    margin: "0 auto",
  },
  logo: {
    textAlign: "center" as const,
    marginBottom: "8px",
  },
});

export function LoginForm() {
  const styles = useStyles();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await trpcCall<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; tenantId: string };
      }>("auth.login", { email, password }, "mutation");
      login(
        result.accessToken,
        result.refreshToken,
        result.user.id,
        result.user.tenantId
      );
    } catch (err: any) {
      setError(err.message ?? "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={styles.root}>
      <div className={styles.logo}>
        <Title3>ClinScriptum</Title3>
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          Войдите для работы с находками
        </Text>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <Field label="Email">
        <Input
          type="email"
          value={email}
          onChange={(_, d) => setEmail(d.value)}
          required
          appearance="outline"
        />
      </Field>

      <Field label="Пароль">
        <Input
          type="password"
          value={password}
          onChange={(_, d) => setPassword(d.value)}
          required
          appearance="outline"
        />
      </Field>

      <Button appearance="primary" type="submit" disabled={loading}>
        {loading ? <Spinner size="tiny" /> : "Войти"}
      </Button>
    </form>
  );
}
