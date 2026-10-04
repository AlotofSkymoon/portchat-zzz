"use client";

import * as React from "react";
import { Download, ImagePlus, Loader2, Sparkles, X } from "lucide-react";

import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  IMAGE_MAX_COUNT,
  IMAGE_RATIOS,
  IMAGE_SIZES,
  LS_KEYS,
} from "@/lib/config";

type GenResult = {
  images: string[];
  sent: { prompt: string; model: string; size: string; ratio: string; n: number };
};

/**
 * 独立生图页。
 *
 * 为什么要跟聊天输入框分开：混在一起时，提示词容易被输入框里的
 * 残留内容、上一条追问污染，出了怪图根本没法判断到底是提示词的锅
 * 还是上游的锅。这里给一个干净的单输入框，并且把「实际发给上游的
 * 内容」原样显示出来，一眼就能对上。
 */
export function CreateView() {
  const { t } = useI18n();

  const [prompt, setPrompt] = React.useState("");
  const [ratio, setRatio] = React.useState<string>("1:1");
  const [size, setSize] = React.useState<string>("1K");
  const [count, setCount] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<GenResult | null>(null);
  const [error, setError] = React.useState("");
  const [refImage, setRefImage] = React.useState<string>("");
  const [refName, setRefName] = React.useState("");

  const fileRef = React.useRef<HTMLInputElement>(null);

  const pickRef = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setError(t("create.refTooBig"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRefImage(String(reader.result ?? ""));
      setRefName(f.name);
      setError("");
    };
    reader.readAsDataURL(f);
  }, [t]);

  const generate = React.useCallback(async () => {
    const p = prompt.trim();
    if (!p) {
      setError(t("create.needPrompt"));
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: p,
          n: count,
          ratio,
          size,
          image: refImage || undefined,
        }),
      });
      const data = (await res.json()) as GenResult & { error?: string };
      if (!res.ok || !data.images?.length) {
        setError(data.error ?? t("create.failed"));
        return;
      }
      setResult({ images: data.images, sent: data.sent });
    } catch {
      setError(t("create.networkErr"));
    } finally {
      setBusy(false);
    }
  }, [count, prompt, ratio, refImage, size, t]);

  const download = React.useCallback(async (url: string, i: number) => {
    try {
      const blob = url.startsWith("data:") ? await (await fetch(url)).blob() : null;
      const href = blob ? URL.createObjectURL(blob) : url;
      const a = document.createElement("a");
      a.href = href;
      a.download = `portchat-${Date.now()}-${i + 1}.png`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (blob) URL.revokeObjectURL(href);
    } catch {
      /* 跨域无法直接下载时，退化为新标签打开 */
      window.open(url, "_blank", "noopener");
    }
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{t("create.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("create.subtitle")}</p>
      </div>

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={t("create.promptPlaceholder")}
        rows={4}
        className="resize-y"
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t("create.ratio")}</div>
          <div className="flex flex-wrap gap-1.5">
            {IMAGE_RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatio(r)}
                className={`rounded-md border px-2 py-1 text-xs transition ${
                  ratio === r ? "border-fg bg-fg/10" : "border-border hover:bg-muted"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t("create.size")}</div>
          <div className="flex flex-wrap gap-1.5">
            {IMAGE_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`rounded-md border px-2 py-1 text-xs transition ${
                  size === s ? "border-fg bg-fg/10" : "border-border hover:bg-muted"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">{t("create.count")}</div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: IMAGE_MAX_COUNT }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCount(n)}
                className={`h-7 w-7 rounded-md border text-xs transition ${
                  count === n ? "border-fg bg-fg/10" : "border-border hover:bg-muted"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={pickRef}
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
          {t("create.refImage")}
        </Button>
        {refImage ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <img src={refImage} alt="" className="h-6 w-6 rounded object-cover" />
            {refName || t("create.refReady")}
            <button
              type="button"
              onClick={() => {
                setRefImage("");
                setRefName("");
              }}
              className="rounded p-0.5 hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{t("create.refHint")}</span>
        )}
      </div>

      <Button className="mt-5 w-full sm:w-auto" onClick={generate} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? t("create.generating") : t("create.generate")}
      </Button>

      {error ? (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-8">
          <div className="mb-3 text-sm font-medium">{t("create.result")}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {result.images.map((u, i) => (
              <div key={`${u}-${i}`} className="group relative overflow-hidden rounded-lg border border-border">
                <img src={u} alt={`${prompt} ${i + 1}`} className="w-full object-cover" />
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-2 top-2 h-8 w-8 opacity-0 transition group-hover:opacity-100"
                  onClick={() => download(u, i)}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* 排查区：把真正发给上游的内容摊开，便于判断怪图是提示词的锅还是上游的锅 */}
          <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-fg">{t("create.actualSent")}</div>
            <div>prompt：{result.sent.prompt}</div>
            <div>
              model：{result.sent.model} · size：{result.sent.size} · ratio：{result.sent.ratio} ·
              n：{result.sent.n}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
