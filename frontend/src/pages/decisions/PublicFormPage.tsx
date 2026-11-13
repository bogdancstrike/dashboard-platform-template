import "@/styles/decisions.css";

import { Alert, Button, Form, Input, Result, Skeleton } from "antd";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { formsApi, type PublicForm, type SubmitResult } from "@/api/forms";
import { FormRenderer } from "@/components/decisions/FormRenderer";
import { TdIcon } from "@/components/decisions/TdIcon";
import { NxIcon, NxLogo } from "@/components/NxIcon";

/**
 * A published intake form, outside the application — the sign-in page's
 * glass, no sidebar, no account needed for a PUBLIC one. The challenge and the
 * honeypot travel with the answers; a person never sees the honeypot.
 */
export function PublicFormPage({ slug }: { slug: string }) {
  const [form, setForm] = useState<PublicForm | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SubmitResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [captcha, setCaptcha] = useState("");
  const [honey, setHoney] = useState("");

  const load = (keepMessage = false) => {
    if (!keepMessage) setFailure(null);
    formsApi.publicForm(slug)
      .then((next) => { setForm(next); setCaptcha(""); })
      .catch((error: unknown) => setFailure(
        error instanceof ApiError && error.status === 404 ? "This form does not exist, or is no longer published."
          : error instanceof ApiError && error.status === 401 ? "This form is for colleagues — sign in to Nucleus and open it again."
          : error instanceof ApiError ? error.message : "The form could not be loaded.",
      ));
  };
  useEffect(() => load(), [slug]);
  useEffect(() => { if (form) document.title = `${form.name} · Nucleus`; }, [form]);

  const submit = async (answers: Record<string, unknown>) => {
    if (!form) return;
    setBusy(true);
    setErrors({});
    try {
      const result = await formsApi.submit(slug, {
        answers,
        [form.honeypot]: honey,
        captcha_token: form.challenge?.token,
        captcha_answer: captcha,
      });
      setDone(result);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = (error.details["fields"] ?? {}) as Record<string, string>;
        setErrors(fields);
        setFailure(error.message);
        if (error.details["field"] === "captcha") load(true);
      } else {
        setFailure("The answer could not be sent. Try again in a moment.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="nx-td-public" data-testid="public-form">
      <div className="nx-td-public-card">
        <div className="nx-td-public-brand"><NxLogo size={30} /> Nucleus</div>
        {!form && !failure && <Skeleton active paragraph={{ rows: 6 }} />}
        {!form && failure && <Result status="404" title="Form not available" subTitle={failure} />}
        {form && done && (
          <div className="nx-td-done" data-testid="public-form-done">
            <div className="nx-td-done-mark"><NxIcon name="check" size={30} stroke={2.4} /></div>
            <h1 className="nx-td-public-title">Thank you</h1>
            <p className="nx-td-public-lede">{done.message}</p>
            {done.reference && <p className="nx-td-faint">Your reference is <b className="nx-td-mono">{done.reference}</b>.</p>}
            <Button onClick={() => { setDone(null); load(); }}>Send another</Button>
          </div>
        )}
        {form && !done && (
          <>
            <h1 className="nx-td-public-title">{form.name}</h1>
            {form.description && <p className="nx-td-public-lede">{form.description}</p>}
            {!form.open ? (
              <Alert type="info" showIcon message="This form is not taking answers right now." />
            ) : (
              <>
                {failure && <Alert type="error" showIcon message={failure} style={{ marginBottom: 16 }} />}
                <FormRenderer
                  fields={form.fields}
                  submitLabel={form.submit_label}
                  busy={busy}
                  errors={errors}
                  onSubmit={(answers) => void submit(answers)}
                  extra={
                    <>
                      <div className="nx-td-honey" aria-hidden="true">
                        <label>Website <input tabIndex={-1} autoComplete="off" value={honey} onChange={(e) => setHoney(e.target.value)} name={form.honeypot} /></label>
                      </div>
                      {form.challenge && (
                        <Form.Item label={form.challenge.question} required>
                          <Input
                            inputMode="numeric"
                            value={captcha}
                            onChange={(event) => setCaptcha(event.target.value)}
                            aria-label="Answer to the question"
                            prefix={<TdIcon name="key" size={14} />}
                            data-testid="form-captcha"
                          />
                        </Form.Item>
                      )}
                    </>
                  }
                />
              </>
            )}
          </>
        )}
        <p className="nx-td-public-foot">Powered by Nucleus · Your answers go straight to the team that handles them.</p>
      </div>
    </main>
  );
}
