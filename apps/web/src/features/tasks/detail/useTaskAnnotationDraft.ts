import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { saveTaskAnnotation, type SaveAnnotationInput, type TaskDetailResult, type TaskSummary } from "../../../api";
import { serializeAnnotationPayload } from "../annotation/geometry";
import { autoSaveDelayMs, autoSaveRetryDelayMs, type SaveStatus } from "./taskDetailCanvas";

type UseTaskAnnotationDraftInput = {
  annotationPayload: SaveAnnotationInput;
  annotationPayloadText: string;
  canAnnotate: boolean;
  loading: boolean;
  onError: (message: string | null) => void;
  onSaved: (result: TaskDetailResult) => void;
  onSavedMessage: (message: string | null) => void;
  savedPayloadKey: string;
  savedPayloadText: string;
  session: Session | null;
  task: TaskSummary | null;
};

export function useTaskAnnotationDraft({
  annotationPayload,
  annotationPayloadText,
  canAnnotate,
  loading,
  onError,
  onSaved,
  onSavedMessage,
  savedPayloadKey,
  savedPayloadText,
  session,
  task
}: UseTaskAnnotationDraftInput) {
  const [draftSaving, setDraftSaving] = useState(false);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const autoSaveRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPayloadTextRef = useRef("");
  const lastSavedPayloadTextRef = useRef("");
  const saveRequestIdRef = useRef(0);
  const syncingSavedPayloadTextRef = useRef<string | null>(null);

  const clearPendingSave = useCallback((options: { cancelInFlight?: boolean } = {}) => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (autoSaveRetryTimerRef.current) {
      clearTimeout(autoSaveRetryTimerRef.current);
      autoSaveRetryTimerRef.current = null;
    }

    if (options.cancelInFlight) {
      saveRequestIdRef.current += 1;
    }
  }, []);

  const hasUnsavedChanges = useCallback(
    () => latestPayloadTextRef.current !== lastSavedPayloadTextRef.current,
    []
  );

  const markPayloadSaved = useCallback((payloadText: string) => {
    latestPayloadTextRef.current = payloadText;
    lastSavedPayloadTextRef.current = payloadText;
    setSaveErrorMessage(null);
    setSaveStatus("idle");
  }, []);

  const setLatestPayloadText = useCallback((payloadText: string) => {
    latestPayloadTextRef.current = payloadText;
  }, []);

  const scheduleAutoSaveRetry = useCallback(
    (payload: SaveAnnotationInput) => {
      if (autoSaveRetryTimerRef.current) {
        clearTimeout(autoSaveRetryTimerRef.current);
      }

      autoSaveRetryTimerRef.current = setTimeout(() => {
        autoSaveRetryTimerRef.current = null;
        void saveDraft(payload, { auto: true });
      }, autoSaveRetryDelayMs);
    },
    []
  );

  async function saveDraft(payload: SaveAnnotationInput, options: { auto: boolean }) {
    if (!session || !task) {
      return false;
    }

    const payloadText = serializeAnnotationPayload(payload);

    if (payloadText === lastSavedPayloadTextRef.current && options.auto) {
      return true;
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    setDraftSaving(true);
    setSaveStatus("saving");
    setSaveErrorMessage(null);
    if (!options.auto) {
      onSavedMessage(null);
    }
    onError(null);

    try {
      const result = await saveTaskAnnotation(session, task.id, payload);

      if (requestId !== saveRequestIdRef.current) {
        return false;
      }

      if (latestPayloadTextRef.current === payloadText) {
        lastSavedPayloadTextRef.current = payloadText;
        onSaved(result);
        setSaveStatus("saved");
        setSaveErrorMessage(null);
        onSavedMessage(options.auto ? "Autosaved." : "Annotation draft saved.");
      } else {
        setSaveStatus("dirty");
      }
      return true;
    } catch (reason) {
      if (requestId !== saveRequestIdRef.current) {
        return false;
      }

      const message = reason instanceof Error ? reason.message : options.auto ? "Unable to autosave annotation." : "Unable to save annotation.";

      setSaveStatus("error");
      setSaveErrorMessage(options.auto ? "Autosave failed. Retrying..." : message);

      if (options.auto) {
        scheduleAutoSaveRetry(payload);
      } else {
        onError(message);
      }
      return false;
    } finally {
      if (requestId === saveRequestIdRef.current) {
        setDraftSaving(false);
      }
    }
  }

  useEffect(() => {
    latestPayloadTextRef.current = savedPayloadText;
    lastSavedPayloadTextRef.current = savedPayloadText;
    syncingSavedPayloadTextRef.current = savedPayloadText;
    setSaveErrorMessage(null);
    setSaveStatus("idle");
    clearPendingSave({ cancelInFlight: true });
  }, [clearPendingSave, savedPayloadKey, savedPayloadText]);

  useEffect(() => {
    if (syncingSavedPayloadTextRef.current !== null) {
      if (annotationPayloadText === syncingSavedPayloadTextRef.current) {
        syncingSavedPayloadTextRef.current = null;
      } else {
        return;
      }
    }

    latestPayloadTextRef.current = annotationPayloadText;

    if (!canAnnotate) {
      return;
    }

    if (annotationPayloadText === lastSavedPayloadTextRef.current) {
      setSaveStatus((current) => (current === "dirty" || current === "error" ? "idle" : current));
      return;
    }

    setSaveErrorMessage(null);
    setSaveStatus((current) => (current === "saving" ? current : "dirty"));
  }, [annotationPayloadText, canAnnotate]);

  useEffect(() => {
    if (!session || !task || !canAnnotate || loading) {
      return;
    }

    if (syncingSavedPayloadTextRef.current !== null) {
      return;
    }

    if (annotationPayloadText === lastSavedPayloadTextRef.current) {
      return;
    }

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    if (autoSaveRetryTimerRef.current) {
      clearTimeout(autoSaveRetryTimerRef.current);
      autoSaveRetryTimerRef.current = null;
    }

    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveDraft(annotationPayload, { auto: true });
    }, autoSaveDelayMs);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [annotationPayload, annotationPayloadText, canAnnotate, loading, session, task?.id]);

  useEffect(() => () => clearPendingSave(), [clearPendingSave]);

  useEffect(() => {
    if (saveStatus !== "saved") {
      return;
    }

    const timer = window.setTimeout(() => {
      setSaveStatus("idle");
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!canAnnotate || !hasUnsavedChanges()) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [canAnnotate, hasUnsavedChanges]);

  return {
    clearPendingSave,
    draftSaving,
    hasUnsavedChanges,
    markPayloadSaved,
    saveDraft,
    saveErrorMessage,
    saveStatus,
    setLatestPayloadText
  };
}
