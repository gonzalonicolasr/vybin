// ClarifyModal — lets the user answer a clarification question from cero.
//
// The sidecar emits { type:"clarify-request", id, question, choices?, allowFree? }.
// This component renders, the user responds, and onResolve fires with a
// ClarifyResponse that gets written back to the sidecar via respond_request.
//
// Keybindings:
//   1–9   select a choice by index
//   Enter confirm (free text, or selected choice)
//   Esc   cancel (sends answer:null, reason:"user cancelled")

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./Modal";
import type { ClarifyRequest, ClarifyResponse } from "./ipc-types";

export interface ClarifyModalProps {
  readonly request: ClarifyRequest;
  readonly onResolve: (response: ClarifyResponse) => void;
  readonly onCancel: () => void;
}

export function ClarifyModal({ request, onResolve, onCancel: _onCancel }: ClarifyModalProps): React.JSX.Element {
  const { id, question, choices, allowFree } = request;

  // If there are choices, selectedIndex tracks the highlighted choice.
  // -1 means "free text mode / nothing selected".
  const [selectedIndex, setSelectedIndex] = useState<number>(choices && choices.length > 0 ? 0 : -1);
  const [freeText, setFreeText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasChoices = (choices?.length ?? 0) > 0;
  const hasFree = allowFree === true || !hasChoices;

  // Focus: if free text → focus textarea; if choices only → no autofocus needed
  useEffect(() => {
    if (hasFree && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [hasFree]);

  // NOTE: onResolve(...) is wired in App.tsx to invoke `respond_request` AND
  // dequeue the modal — calling onCancel() after it would dequeue twice and
  // leave the queue in an inconsistent state (potential blank-screen crash if
  // a stale entry gets popped). So onResolve is the single exit point, and
  // onCancel is reserved for the "no response sent to sidecar" path used by
  // the parent's own teardown (e.g. tab close).

  const handleConfirm = useCallback((): void => {
    if (hasChoices && selectedIndex >= 0 && !freeText.trim()) {
      onResolve({
        type: "clarify-response",
        id,
        answer: choices![selectedIndex] ?? null,
        choiceIndex: selectedIndex,
      });
    } else if (freeText.trim()) {
      const resp: ClarifyResponse = {
        type: "clarify-response",
        id,
        answer: freeText.trim(),
        ...(hasChoices && selectedIndex >= 0 ? { choiceIndex: selectedIndex } : {}),
      };
      onResolve(resp);
    } else {
      // Nothing entered — send explicit "cancelled" answer so the sidecar
      // doesn't sit on its 60s timeout. onResolve dequeues internally.
      onResolve({ type: "clarify-response", id, answer: null, reason: "user cancelled (empty)" });
    }
  }, [id, choices, hasChoices, selectedIndex, freeText, onResolve]);

  const handleCancel = useCallback((): void => {
    onResolve({ type: "clarify-response", id, answer: null, reason: "user cancelled" });
  }, [id, onResolve]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Number keys 1–9: select choice
      if (hasChoices && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        if (choices && idx < choices.length) {
          e.preventDefault();
          setSelectedIndex(idx);
          // If no free text mode, auto-confirm on second press of same key
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && document.activeElement !== textareaRef.current) {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handler, true);
    return (): void => window.removeEventListener("keydown", handler, true);
  }, [hasChoices, choices, handleConfirm]);

  return (
    <Modal onEscape={handleCancel} width="min(600px, 96vw)" className="clarify-modal">
      <ModalHeader>
        <span className="modal-icon">?</span>
        <h2 className="modal-title">CLARIFICATION NEEDED</h2>
      </ModalHeader>

      <ModalBody>
        <div className="clarify-question">
          <Markdown text={question} />
        </div>

        {hasChoices && (
          <div className="clarify-choices" role="listbox" aria-label="choices">
            {choices!.map((choice, i) => (
              <button
                key={i}
                className={`clarify-choice${selectedIndex === i ? " clarify-choice-selected" : ""}`}
                onClick={(): void => setSelectedIndex(i)}
                onDoubleClick={(): void => {
                  // onResolve dequeues internally — don't also call onCancel.
                  setSelectedIndex(i);
                  onResolve({ type: "clarify-response", id, answer: choice, choiceIndex: i });
                }}
                role="option"
                aria-selected={selectedIndex === i}
              >
                <span className="clarify-choice-key">{i + 1}</span>
                <span className="clarify-choice-text">{choice}</span>
              </button>
            ))}
          </div>
        )}

        {hasFree && (
          <div className="clarify-free">
            {hasChoices && (
              <div className="clarify-free-label">or type a custom answer:</div>
            )}
            <textarea
              ref={textareaRef}
              className="clarify-textarea"
              value={freeText}
              onChange={(e): void => setFreeText(e.target.value)}
              onKeyDown={(e): void => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              placeholder="Type your answer… (Enter to send, Shift+Enter for newline)"
              rows={3}
            />
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <button className="settings-btn-secondary" onClick={handleCancel}>
          cancel (Esc)
        </button>
        <button className="settings-btn-primary" onClick={handleConfirm}>
          send
        </button>
      </ModalFooter>
    </Modal>
  );
}
