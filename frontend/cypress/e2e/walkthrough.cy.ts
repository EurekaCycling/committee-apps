describe('walkthrough video', () => {
  const audioDir = 'cypress/voiceover/audio';

  const timeline: Array<{ file: string; startMs: number; durationMs: number; endMs: number }> = [];
  let recordingStartMs: number | null = null;

  const advanceTime = (ms: number) => {
    if (ms <= 0) {
      return cy.wrap(null, { log: false });
    }
    return cy.wait(ms, { log: false });
  };

  const pointerId = 'cy-mouse-pointer';
  const pointerBaseOpacity = 0.35;

  const easeInOutCubic = (t: number) => {
    if (t < 0.5) {
      return 4 * t * t * t;
    }
    return 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  const initPointer = () => {
    return cy.window().then((win) => {
      if (win.document.getElementById(pointerId)) {
        return;
      }
      const pointer = win.document.createElement('div');
      pointer.id = pointerId;
      pointer.style.position = 'fixed';
      pointer.style.left = '80px';
      pointer.style.top = '80px';
      pointer.style.width = '18px';
      pointer.style.height = '18px';
      pointer.style.borderRadius = '50%';
      pointer.style.background = 'rgba(36, 120, 255, 0.6)';
      pointer.style.opacity = String(pointerBaseOpacity);
      pointer.style.boxShadow = '0 0 0 4px rgba(36, 120, 255, 0.2)';
      pointer.style.pointerEvents = 'none';
      pointer.style.zIndex = '9999';
      pointer.style.transform = 'translate(-50%, -50%)';
      pointer.style.transition = 'opacity 140ms ease';
      win.document.body.appendChild(pointer);
    });
  };

  const movePointer = (x: number, y: number, durationMs = 700) => {
    return cy.window().then((win) => new Cypress.Promise<void>((resolve) => {
      const pointer = win.document.getElementById(pointerId);
      if (!pointer) {
        resolve();
        return;
      }
      const startX = Number.parseFloat(pointer.style.left) || 0;
      const startY = Number.parseFloat(pointer.style.top) || 0;
      const startTime = win.performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeInOutCubic(progress);
        const currentX = startX + (x - startX) * eased;
        const currentY = startY + (y - startY) * eased;
        pointer.style.left = `${currentX}px`;
        pointer.style.top = `${currentY}px`;
        if (progress < 1) {
          win.requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      win.requestAnimationFrame(tick);
    }));
  };

  const clickPointer = () => {
    return cy.window().then((win) => new Cypress.Promise<void>((resolve) => {
      const pointer = win.document.getElementById(pointerId);
      if (!pointer) {
        resolve();
        return;
      }
      pointer.style.opacity = '0.85';
      win.setTimeout(() => {
        pointer.style.opacity = String(pointerBaseOpacity);
        win.setTimeout(resolve, 160);
      }, 140);
    }));
  };

  const movePointerToElement = (element: JQuery<HTMLElement>, durationMs = 700) => {
    const rect = element[0].getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;
    const targetY = rect.top + rect.height / 2;
    return movePointer(targetX, targetY, durationMs);
  };

  const clickWithPointer = (element: JQuery<HTMLElement>, durationMs = 700) => {
    return movePointerToElement(element, durationMs).then(() => clickPointer());
  };

  const smoothScrollTo = (targetY: number, durationMs = 2000) => {
    return cy.window().then((win) => new Cypress.Promise<void>((resolve) => {
      const startY = win.scrollY || 0;
      const delta = targetY - startY;
      const startTime = win.performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startTime) / durationMs);
        const eased = easeInOutCubic(progress);
        win.scrollTo(0, startY + delta * eased);
        if (progress < 1) {
          win.requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      win.requestAnimationFrame(tick);
    }));
  };

  const smoothScrollToElement = (selector: string, durationMs = 2000) => {
    return cy.get(selector).then(($el) => {
      return cy.window().then((win) => {
        const rect = $el[0].getBoundingClientRect();
        const targetY = rect.top + win.scrollY;
        return smoothScrollTo(targetY, durationMs);
      });
    });
  };

  const measureAudioDuration = (fileName: string) => {
    return cy.readFile(`${audioDir}/${fileName}`, 'base64').then((base64) => {
      return cy.window().then((win) => {
        return cy.then({ timeout: 10000 }, () => new Cypress.Promise<{
          durationSeconds: number;
          startMs: number;
        }>((resolve) => {
          const audio = new win.Audio(`data:audio/mpeg;base64,${base64}`);
          audio.preload = 'auto';
          audio.muted = true;
          audio.volume = 0;

          let resolved = false;
          const safeResolve = (payload: { durationSeconds: number; startMs: number }) => {
            if (resolved) return;
            resolved = true;
            resolve(payload);
          };

          const fallback = win.setTimeout(
            () => safeResolve({ durationSeconds: 0, startMs: 0 }),
            15000,
          );

          let playStartPerf: number | null = null;
          let playStartMs: number | null = null;

          const resolveWith = (durationSeconds: number) => {
            const startMs =
              recordingStartMs === null || playStartMs === null
                ? 0
                : Math.max(0, playStartMs - recordingStartMs);
            safeResolve({ durationSeconds, startMs });
          };

          audio.onplaying = () => {
            playStartPerf = win.performance.now();
            playStartMs = win.Date.now();
          };

          audio.onended = () => {
            win.clearTimeout(fallback);
            const endTime = win.performance.now();
            const durationSeconds = playStartPerf === null ? 0 : (endTime - playStartPerf) / 1000;
            resolveWith(durationSeconds);
          };

          audio.onerror = () => {
            win.clearTimeout(fallback);
            resolveWith(0);
          };

          audio.load();
          audio.play().catch(() => {
            win.clearTimeout(fallback);
            resolveWith(0);
          });
        }));
      });
    });
  };

  const scheduleAudio = (fileName: string) => {
    return measureAudioDuration(fileName).then(({ durationSeconds, startMs }) => {
      const durationMs = Math.max(0, Math.ceil(durationSeconds * 1000));
      const endMs = startMs + durationMs;
      timeline.push({ file: fileName, startMs, durationMs, endMs });
    });
  };

  it('records the committee walkthrough flow', () => {
    const username = Cypress.env('APP_USER');
    const password = Cypress.env('APP_PASS');

    const transition = 800;

    cy.then(() => {
      recordingStartMs = Date.now();
    });
    cy.visit('/');
    initPointer();

    cy.get('input[name="username"]').should('be.visible');
    scheduleAudio('01-intro.mp3');
    scheduleAudio('02-signin-1.mp3');
    scheduleAudio('03-signin-2.mp3');
    cy.get('input[name="username"]').type(username, { log: false });
    cy.get('input[name="password"]').type(password, { log: false });
    cy.get('button[type="submit"]').then(($el) => {
      return clickWithPointer($el).then(() => cy.wrap($el).click());
    });

    cy.contains('h1', 'Welcome').should('be.visible');
    scheduleAudio('04-home.mp3');

    cy.contains('a', 'Ledger').then(($el) => {
      return clickWithPointer($el).then(() => cy.wrap($el).click());
    });
    cy.contains('h1', 'Ledger').should('be.visible');
    cy.get('.month-block').should('exist');
    scheduleAudio('05-ledger.mp3');

    cy.contains('a', 'Reports').then(($el) => {
      return clickWithPointer($el).then(() => cy.wrap($el).click());
    });
    cy.contains('h1', 'Financial Reports').should('be.visible');
    cy.get('.period-pill').eq(1).then(($el) => {
      return clickWithPointer($el, 600).then(() => cy.wrap($el).click());
    });
    advanceTime(transition);
    cy.get('.period-pill').eq(2).then(($el) => {
      return clickWithPointer($el, 600).then(() => cy.wrap($el).click());
    });
    advanceTime(transition);
    cy.get('.period-pill').eq(0).then(($el) => {
      return clickWithPointer($el, 600).then(() => cy.wrap($el).click());
    });
    scheduleAudio('06-reports.mp3');

    cy.contains('a', 'Reimbursements').then(($el) => {
      return clickWithPointer($el).then(() => cy.wrap($el).click());
    });
    cy.contains('h1', 'Reimbursements').should('be.visible');
    advanceTime(500);
    smoothScrollToElement('.reimbursements-list', 2200);
    advanceTime(transition);
    smoothScrollToElement('.reimbursements-form', 2200);
    scheduleAudio('07-reimbursements.mp3');

    cy.contains('a', 'Documents').then(($el) => {
      return clickWithPointer($el).then(() => cy.wrap($el).click());
    });
    cy.get('.docs-header').should('be.visible');
    advanceTime(500);
    smoothScrollToElement('.file-list', 2200);
    scheduleAudio('08-documents.mp3');
    scheduleAudio('09-wrap-1.mp3');
    scheduleAudio('10-wrap-2.mp3');

    cy.writeFile('cypress/voiceover/timeline.json', timeline, { log: false });
  });
});
