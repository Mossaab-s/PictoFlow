"use client";
import { useEffect, useRef, useState } from "react";
import { api, APIError } from "@/lib/api";
import {
  sameProviderEndpoint,
  probeLabels,
  type ProviderOptions,
  type ProviderConfiguration,
  type ProviderProbe,
} from "@/lib/provider-configuration";

export default function ProviderSettings({ onSaved }: { onSaved: () => void }) {
  const [config, setConfig] = useState<ProviderConfiguration | null>(null);
  const [draft, setDraft] = useState<ProviderOptions | null>(null);
  const [keyAction, setKeyAction] = useState<"keep" | "replace" | "clear">(
    "keep",
  );
  const [key, setKey] = useState("");
  const [probe, setProbe] = useState<ProviderProbe | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"load" | "test" | "save" | null>("load");
  const [needsReload, setNeedsReload] = useState(false);
  const pending = useRef<AbortController | null>(null);

  function accept(value: ProviderConfiguration) {
    setConfig(value);
    const {
      provider,
      base_url,
      model,
      response_format,
      timeout_seconds,
      temperature,
    } = value;
    setDraft({
      provider,
      base_url,
      model,
      response_format,
      timeout_seconds,
      temperature,
    });
    setKeyAction("keep");
    setKey("");
    setNeedsReload(false);
    setProbe(null);
  }
  async function load() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy("load");
    setError("");
    setNotice("");
    setKey("");
    try {
      const value = await api<ProviderConfiguration>(
        "providers/configuration",
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) accept(value);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : "Chargement impossible.");
        setNeedsReload(true);
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, []);

  function change(values: Partial<ProviderOptions>) {
    setDraft((current) => (current ? { ...current, ...values } : current));
    setProbe(null);
    setNotice("");
    setError("");
  }
  const changedEndpoint =
    config && draft && !sameProviderEndpoint(config, draft);
  const needsKeyChoice = !!(
    config?.api_key_configured &&
    changedEndpoint &&
    keyAction === "keep"
  );
  async function perform(action: "test" | "save") {
    if (!config || !draft || busy || needsReload || needsKeyChoice) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(action);
    setError("");
    setNotice("");
    setProbe(null);
    const payload = {
      ...draft,
      expected_version: config.version,
      key_action: keyAction,
      ...(keyAction === "replace" ? { api_key: key.trim() } : {}),
    };
    try {
      if (action === "test") {
        const result = await api<ProviderProbe>("providers/test", {
          method: "POST",
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setProbe(result);
      } else {
        const result = await api<ProviderConfiguration>(
          "providers/configuration",
          {
            method: "PUT",
            body: JSON.stringify(payload),
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) {
          accept(result);
          onSaved();
          setNotice(
            "Configuration enregistrée et active pour les prochaines demandes. Les demandes déjà lancées conservent leur fournisseur.",
          );
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        const stale = e instanceof APIError && e.status === 409;
        const uncertain =
          action === "save" && (!(e instanceof APIError) || e.status >= 500);
        setNeedsReload(stale || uncertain);
        setError(
          stale
            ? "La configuration a changé dans un autre onglet. Rechargez-la avant de continuer."
            : uncertain
              ? "L’enregistrement n’a pas pu être confirmé. Rechargez la configuration pour connaître l’état réellement enregistré avant de réessayer."
              : e instanceof APIError && e.status === 422
                ? "Vérifiez l’adresse, le modèle et le choix de clé. Aucun réglage n’a été enregistré."
                : e instanceof Error
                  ? e.message
                  : "Opération impossible.",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(null);
        if (action === "save") setKey("");
      }
    }
  }
  return (
    <section aria-label="Configuration du fournisseur IA">
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy === "load" && <p role="status">Chargement de la configuration…</p>}
      {config && draft && (
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            void perform("save");
          }}
        >
          <h2>Configurer l’assistance IA</h2>
          <p>
            Ces réglages s’appliquent à tous les profils. Ils restent
            enregistrés après un redémarrage.
          </p>
          <p className="helper">
            Origine :{" "}
            {config.source === "admin"
              ? "configuration enregistrée dans l’administration"
              : "configuration initiale du serveur"}
            . La clé existante reste côté serveur.
          </p>
          <fieldset disabled={!!busy || needsReload}>
            <legend>Paramètres du fournisseur</legend>
            <label>
              Fournisseur
              <select
                value={draft.provider}
                onChange={(event) =>
                  change({
                    provider: event.target.value as ProviderOptions["provider"],
                  })
                }
              >
                <option value="disabled">Sans assistance IA</option>
                <option value="openai-compatible">API compatible OpenAI</option>
                <option value="prism">PRISM</option>
                <option value="fake">Simulation locale (FakeProvider)</option>
              </select>
            </label>
            {draft.provider === "fake" && (
              <p className="helper">
                La simulation utilise des exemples fictifs prédéfinis. Elle ne
                vérifie pas la qualité d’un modèle externe.
              </p>
            )}
            <label>
              Adresse de base de l’API
              <input
                type="url"
                maxLength={2048}
                value={draft.base_url ?? ""}
                required={["openai-compatible", "prism"].includes(
                  draft.provider,
                )}
                placeholder="https://api.exemple.com/v1"
                onChange={(event) =>
                  change({ base_url: event.target.value || null })
                }
              />
            </label>
            <label>
              Modèle
              <input
                maxLength={128}
                value={draft.model ?? ""}
                required={draft.provider === "openai-compatible"}
                onChange={(event) =>
                  change({ model: event.target.value || null })
                }
              />
            </label>
            <label>
              Format de réponse
              <select
                value={draft.response_format}
                onChange={(event) =>
                  change({
                    response_format: event.target
                      .value as ProviderOptions["response_format"],
                  })
                }
              >
                <option value="json_object">JSON Object</option>
                <option value="json_schema">JSON Schema strict</option>
              </select>
            </label>
            <p className="helper">
              Le format et la température concernent les API compatibles OpenAI.
            </p>
            <label>
              Température (vide : choix du fournisseur)
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={draft.temperature ?? ""}
                onChange={(event) =>
                  change({
                    temperature:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              Délai maximal en secondes
              <input
                type="number"
                min="1"
                max="120"
                required
                value={draft.timeout_seconds}
                onChange={(event) =>
                  change({ timeout_seconds: Number(event.target.value) })
                }
              />
            </label>
            <p>
              Clé d’API :{" "}
              {config.api_key_configured
                ? "une clé est enregistrée"
                : "aucune clé enregistrée"}
              .
            </p>
            <label>
              Action sur la clé
              <select
                value={keyAction}
                onChange={(event) => {
                  setKeyAction(event.target.value as typeof keyAction);
                  setKey("");
                  setProbe(null);
                  setNotice("");
                }}
              >
                <option
                  value="keep"
                  disabled={!!(config.api_key_configured && changedEndpoint)}
                >
                  Conserver la clé existante
                </option>
                <option value="replace">Utiliser une nouvelle clé</option>
                <option value="clear">
                  Sans clé : retirer la clé enregistrée
                </option>
              </select>
            </label>
            {needsKeyChoice && (
              <p role="status">
                Le fournisseur ou l’adresse a changé. Choisissez une nouvelle
                clé ou « Sans clé » ; l’ancienne clé ne sera pas envoyée à cette
                adresse.
              </p>
            )}
            {keyAction === "replace" && (
              <label>
                Nouvelle clé d’API
                <input
                  type="password"
                  autoComplete="new-password"
                  maxLength={4096}
                  required
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                    setProbe(null);
                  }}
                />
              </label>
            )}
            <p className="helper">
              Le test envoie uniquement l’exemple fictif « Moi → Boire → Eau »
              au fournisseur saisi. Il peut consommer des crédits API. Aucun
              message de profil n’est envoyé et rien n’est appris ou enregistré
              par ce test.
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={
                  needsKeyChoice || (keyAction === "replace" && !key.trim())
                }
                onClick={(event) => {
                  if (event.currentTarget.form?.reportValidity())
                    void perform("test");
                }}
              >
                Tester sans enregistrer
              </button>
              <button
                type="submit"
                disabled={
                  needsKeyChoice || (keyAction === "replace" && !key.trim())
                }
              >
                Enregistrer et activer
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {busy === "test" && (
        <p role="status">Test de connexion et de formulation en cours…</p>
      )}
      {busy === "save" && <p role="status">Enregistrement en cours…</p>}
      {probe && (
        <section
          className="provider-card"
          aria-label="Résultat du test"
          role="status"
        >
          <h2>Résultat du test</h2>
          <p>Métadonnées : {probe.connection}.</p>
          <p>{probeLabels[probe.generation]}</p>
          {probe.candidates.length > 0 && (
            <ul>
              {probe.candidates.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          )}
          <p>
            Configuration active inchangée. Une réponse structurée ne prouve pas
            que le sens est juste.
          </p>
        </section>
      )}
      <button
        type="button"
        className="secondary"
        onClick={load}
        disabled={!!busy}
      >
        Recharger la configuration
      </button>
      <p className="helper">
        Recharger abandonne les modifications du formulaire et relit les
        réglages enregistrés.
      </p>
    </section>
  );
}
