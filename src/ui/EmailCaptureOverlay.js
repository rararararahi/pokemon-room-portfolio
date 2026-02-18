export default class EmailCaptureOverlay {
  constructor({ onSubmit, onCancel, onOpen, onClose } = {}) {
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this._isOpen = false;
    this.scrollLockState = null;

    this.root = document.createElement("div");
    this.root.style.position = "fixed";
    this.root.style.inset = "0";
    this.root.style.display = "none";
    this.root.style.alignItems = "center";
    this.root.style.justifyContent = "center";
    this.root.style.background = "rgba(0,0,0,0.72)";
    this.root.style.zIndex = "999999";
    this.root.style.padding = "16px";
    this.root.style.boxSizing = "border-box";
    this.root.style.touchAction = "none";
    this.root.style.pointerEvents = "auto";

    this.panel = document.createElement("div");
    this.panel.style.width = "min(420px, 96vw)";
    this.panel.style.background = "#f7f7f7";
    this.panel.style.border = "3px solid #111";
    this.panel.style.boxShadow = "0 12px 24px rgba(0,0,0,0.35)";
    this.panel.style.padding = "16px";
    this.panel.style.fontFamily = "monospace";

    const title = document.createElement("div");
    title.textContent = "SAVE YOUR NAME FOR TROPHIES";
    title.style.fontSize = "15px";
    title.style.fontWeight = "700";
    title.style.marginBottom = "10px";

    const subtitle = document.createElement("div");
    subtitle.textContent = "Enter your name + email to register purchases in the trophy room.";
    subtitle.style.fontSize = "12px";
    subtitle.style.marginBottom = "12px";

    this.nameInput = document.createElement("input");
    this.nameInput.type = "text";
    this.nameInput.placeholder = "Name";
    this.nameInput.autocomplete = "name";
    this.nameInput.style.width = "100%";
    this.nameInput.style.padding = "10px";
    this.nameInput.style.marginBottom = "8px";
    this.nameInput.style.border = "2px solid #222";
    this.nameInput.style.background = "#fff";
    this.nameInput.style.boxSizing = "border-box";
    this.nameInput.style.fontSize = "16px";
    this.nameInput.style.lineHeight = "1.2";

    this.emailInput = document.createElement("input");
    this.emailInput.type = "email";
    this.emailInput.placeholder = "Email";
    this.emailInput.autocomplete = "email";
    this.emailInput.style.width = "100%";
    this.emailInput.style.padding = "10px";
    this.emailInput.style.marginBottom = "10px";
    this.emailInput.style.border = "2px solid #222";
    this.emailInput.style.background = "#fff";
    this.emailInput.style.boxSizing = "border-box";
    this.emailInput.style.fontSize = "16px";
    this.emailInput.style.lineHeight = "1.2";

    this.message = document.createElement("div");
    this.message.style.minHeight = "18px";
    this.message.style.fontSize = "11px";
    this.message.style.color = "#8b0000";
    this.message.style.marginBottom = "10px";

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";

    this.submitBtn = document.createElement("button");
    this.submitBtn.type = "button";
    this.submitBtn.textContent = "Submit";
    this.submitBtn.style.flex = "1";
    this.submitBtn.style.padding = "10px";
    this.submitBtn.style.border = "2px solid #111";
    this.submitBtn.style.background = "#c9f86a";
    this.submitBtn.style.cursor = "pointer";

    this.cancelBtn = document.createElement("button");
    this.cancelBtn.type = "button";
    this.cancelBtn.textContent = "Not now";
    this.cancelBtn.style.flex = "1";
    this.cancelBtn.style.padding = "10px";
    this.cancelBtn.style.border = "2px solid #111";
    this.cancelBtn.style.background = "#efefef";
    this.cancelBtn.style.cursor = "pointer";

    btnRow.appendChild(this.submitBtn);
    btnRow.appendChild(this.cancelBtn);

    this.panel.appendChild(title);
    this.panel.appendChild(subtitle);
    this.panel.appendChild(this.emailInput);
    this.panel.appendChild(this.nameInput);
    this.panel.appendChild(this.message);
    this.panel.appendChild(btnRow);
    this.root.appendChild(this.panel);

    const stopPropagationCapture = (event) => {
      event.stopPropagation();
    };
    const stopPropagationCaptureNonPassive = (event) => {
      event.stopPropagation();
    };
    const stopKeyPropagation = (event) => {
      event.stopPropagation();
    };

    this.root.addEventListener("pointerdown", stopPropagationCapture, { capture: true });
    this.root.addEventListener("pointerup", stopPropagationCapture, { capture: true });
    this.root.addEventListener("touchstart", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.root.addEventListener("touchend", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.root.addEventListener("keydown", stopKeyPropagation, true);

    this.panel.addEventListener("pointerdown", stopPropagationCapture, { capture: true });
    this.panel.addEventListener("pointerup", stopPropagationCapture, { capture: true });
    this.panel.addEventListener("touchstart", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.panel.addEventListener("touchend", stopPropagationCaptureNonPassive, { capture: true, passive: false });

    this.nameInput.addEventListener("pointerdown", stopPropagationCapture, { capture: true });
    this.nameInput.addEventListener("pointerup", stopPropagationCapture, { capture: true });
    this.nameInput.addEventListener("touchstart", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.nameInput.addEventListener("touchend", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.nameInput.addEventListener("pointerdown", () => this.focusInput(this.nameInput), { capture: true });
    this.nameInput.addEventListener("keydown", stopKeyPropagation, true);
    this.nameInput.addEventListener("keyup", stopKeyPropagation, true);
    this.nameInput.addEventListener("keypress", stopKeyPropagation, true);

    this.emailInput.addEventListener("pointerdown", stopPropagationCapture, { capture: true });
    this.emailInput.addEventListener("pointerup", stopPropagationCapture, { capture: true });
    this.emailInput.addEventListener("touchstart", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.emailInput.addEventListener("touchend", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.emailInput.addEventListener("pointerdown", () => this.focusInput(this.emailInput), { capture: true });
    this.emailInput.addEventListener("keydown", stopKeyPropagation, true);
    this.emailInput.addEventListener("keyup", stopKeyPropagation, true);
    this.emailInput.addEventListener("keypress", stopKeyPropagation, true);

    this.submitBtn.addEventListener("pointerdown", stopPropagationCapture, { capture: true });
    this.submitBtn.addEventListener("pointerup", stopPropagationCapture, { capture: true });
    this.submitBtn.addEventListener("touchstart", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.submitBtn.addEventListener("touchend", stopPropagationCaptureNonPassive, { capture: true, passive: false });

    this.cancelBtn.addEventListener("pointerdown", stopPropagationCapture, { capture: true });
    this.cancelBtn.addEventListener("pointerup", stopPropagationCapture, { capture: true });
    this.cancelBtn.addEventListener("touchstart", stopPropagationCaptureNonPassive, { capture: true, passive: false });
    this.cancelBtn.addEventListener("touchend", stopPropagationCaptureNonPassive, { capture: true, passive: false });

    this.submitBtn.addEventListener("click", () => {
      this.handleSubmit();
    });
    this.cancelBtn.addEventListener("click", () => {
      this.handleNotNow();
    });

    this.onKeyDown = (event) => {
      if (!this._isOpen) return;
      if (event.key === "Escape") {
        event.preventDefault();
        this.handleNotNow();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.handleSubmit();
      }
    };

    document.body.appendChild(this.root);
  }

  isOpen() {
    return this._isOpen;
  }

  focusInput(inputEl) {
    if (!inputEl) return;
    try {
      inputEl.focus({ preventScroll: true });
    } catch {
      inputEl.focus();
    }
  }

  lockPageScroll() {
    if (this.scrollLockState || typeof window === "undefined") return;
    const docEl = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    this.scrollLockState = {
      scrollY,
      docOverflow: docEl.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyWidth: body.style.width,
      bodyTop: body.style.top,
    };
    docEl.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.width = "100%";
    body.style.top = `-${scrollY}px`;
  }

  unlockPageScroll() {
    if (!this.scrollLockState || typeof window === "undefined") return;
    const docEl = document.documentElement;
    const body = document.body;
    const { scrollY, docOverflow, bodyOverflow, bodyPosition, bodyWidth, bodyTop } = this.scrollLockState;
    docEl.style.overflow = docOverflow;
    body.style.overflow = bodyOverflow;
    body.style.position = bodyPosition;
    body.style.width = bodyWidth;
    body.style.top = bodyTop;
    this.scrollLockState = null;
    window.scrollTo(0, scrollY || 0);
  }

  open({ name = "", email = "" } = {}) {
    this._isOpen = true;
    this.root.style.display = "flex";
    this.lockPageScroll();
    this.message.textContent = "";
    this.message.style.color = "#8b0000";
    this.nameInput.value = name;
    this.emailInput.value = email;
    document.addEventListener("keydown", this.onKeyDown);
    this.focusInput(this.emailInput);
    if (typeof this.onOpen === "function") this.onOpen();
  }

  close() {
    this._isOpen = false;
    this.root.style.display = "none";
    document.removeEventListener("keydown", this.onKeyDown);
    this.unlockPageScroll();
    if (typeof this.onClose === "function") this.onClose();
  }

  setPending(isPending) {
    this.submitBtn.disabled = isPending;
    this.cancelBtn.disabled = isPending;
    this.nameInput.disabled = isPending;
    this.emailInput.disabled = isPending;
    this.submitBtn.style.opacity = isPending ? "0.7" : "1";
  }

  validEmail(value) {
    const v = String(value || "").trim();
    return v.includes("@") && v.includes(".");
  }

  async handleSubmit() {
    const name = this.nameInput.value.trim();
    const email = this.emailInput.value.trim();

    if (!name) {
      this.message.textContent = "Name is required.";
      return;
    }

    if (!this.validEmail(email)) {
      this.message.textContent = "Enter a valid email address.";
      return;
    }

    if (typeof this.onSubmit !== "function") {
      this.close();
      return;
    }

    this.setPending(true);
    this.message.textContent = "Submitting...";
    this.message.style.color = "#222";

    try {
      await this.onSubmit({ name, email });
      this.message.textContent = "Saved. Thank you.";
      this.message.style.color = "#1b5e20";
      setTimeout(() => {
        this.close();
      }, 650);
    } catch (err) {
      this.message.style.color = "#8b0000";
      this.message.textContent = err?.message || "Failed to submit. Try again.";
    } finally {
      this.setPending(false);
    }
  }

  handleNotNow() {
    this.close();
    if (typeof this.onCancel === "function") this.onCancel();
  }

  destroy() {
    document.removeEventListener("keydown", this.onKeyDown);
    this.unlockPageScroll();
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this._isOpen = false;
  }
}
