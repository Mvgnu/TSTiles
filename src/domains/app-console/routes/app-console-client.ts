/** Progressive enhancement for copy actions, settings forms, and hosted handoffs. */
export function renderAppConsoleClientScript(): string {
  return `
    <script>
      (function () {
        function escapeHtml(value) {
          return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        }

        function normalizeOrigins(value) {
          return String(value)
            .split(/\\n|,/)
            .map(function (entry) { return entry.trim(); })
            .filter(function (entry) { return entry.length > 0; });
        }

        async function parseJson(response) {
          const text = await response.text();
          if (!text) {
            return {};
          }
          try {
            return JSON.parse(text);
          } catch (_error) {
            return {};
          }
        }

        async function requestJson(url, init) {
          try {
            const response = await fetch(url, init);
            return {
              ok: response.ok,
              data: await parseJson(response)
            };
          } catch (_error) {
            return {
              ok: false,
              data: null
            };
          }
        }

        async function copyText(value) {
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              await navigator.clipboard.writeText(value);
              return true;
            }
          } catch (_error) {
            // Fall through to the legacy copy path below.
          }
          const input = document.createElement("textarea");
          try {
            input.value = value;
            document.body.appendChild(input);
            input.select();
            return document.execCommand("copy");
          } catch (_error) {
            return false;
          } finally {
            input.remove();
          }
        }

        function setStatus(node, value, isError) {
          if (!node) {
            return;
          }
          node.textContent = value;
          node.classList.toggle("danger-text", Boolean(isError));
        }

        function stripAccessTokenQueryParam(url) {
          var value = String(url || "");
          var hashIndex = value.indexOf("#");
          var beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
          var hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
          var queryIndex = beforeHash.indexOf("?");
          if (queryIndex < 0) {
            return value;
          }
          var pathname = beforeHash.slice(0, queryIndex);
          var query = beforeHash.slice(queryIndex + 1);
          var filtered = query.split("&").filter(function (entry) {
            return entry && entry.indexOf("access_token=") !== 0;
          });
          return pathname + (filtered.length > 0 ? "?" + filtered.join("&") : "") + hash;
        }

        function snippetMarkup(snippets) {
          const parts = [];
          function pushCard(title, description, queryCode, headerCode) {
            const queryEscaped = escapeHtml(queryCode);
            const headerEscaped = escapeHtml(headerCode);
            parts.push(
              '<article class="ds-card snippet-card" data-snippet-card data-query-code="' + queryEscaped + '" data-header-code="' + headerEscaped + '" data-preferred-mode="query">' +
                '<div class="card-head split">' +
                  '<div><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(description) + '</p></div>' +
                  '<div class="mode-toggle">' +
                    '<button class="mode-button" type="button" data-snippet-mode="query">Query token</button>' +
                    '<button class="mode-button" type="button" data-snippet-mode="header">Header token</button>' +
                  '</div>' +
                '</div>' +
                '<pre class="code-block" data-snippet-code>' + queryEscaped + '</pre>' +
                '<div class="card-actions"><button class="ds-button ds-button-secondary" type="button" data-copy-snippet>Copy snippet</button></div>' +
              '</article>'
            );
          }

          if (snippets.styleUrl) {
            const headerUrl = stripAccessTokenQueryParam(snippets.styleUrl);
            pushCard(
              "MapLibre style example",
              "Browser-first path using the published style URL.",
              'const map = new maplibregl.Map({\\n  container: "map",\\n  style: "' + String(snippets.styleUrl) + '",\\n});',
              'const token = "{access_token}";\\nconst map = new maplibregl.Map({\\n  container: "map",\\n  style: "' + headerUrl + '",\\n  transformRequest: (url) => ({\\n    url,\\n    headers: { Authorization: "Bearer " + token },\\n  }),\\n});'
            );
          }
          if (snippets.rasterTileUrl) {
            const headerUrl = stripAccessTokenQueryParam(snippets.rasterTileUrl);
            pushCard(
              "Raster tiles",
              "Static image tile fallback.",
              'curl "' + String(snippets.rasterTileUrl) + '" --output tile.png',
              'curl -H "Authorization: Bearer {access_token}" "' + headerUrl + '" --output tile.png'
            );
          }
          if (snippets.staticMapUrl) {
            const headerUrl = stripAccessTokenQueryParam(snippets.staticMapUrl);
            pushCard(
              "Static maps",
              "Generate images for previews, email, and sharing.",
              'curl "' + String(snippets.staticMapUrl) + '" --output map.png',
              'curl -H "Authorization: Bearer {access_token}" "' + headerUrl + '" --output map.png'
            );
          }
          return parts.join("");
        }

        function provisionMarkup(result) {
          const projectName = result && result.project && typeof result.project.name === "string" ? result.project.name : "New project";
          const projectId = result && result.project && typeof result.project.id === "string" ? result.project.id : "";
          const token = result && result.issuedKey && typeof result.issuedKey.token === "string" ? result.issuedKey.token : "";
          const snippets = result && result.snippets && typeof result.snippets === "object" ? result.snippets : {};
          return '' +
            '<article class="ds-card focus-card" data-provision-result-card>' +
              '<div class="card-head split"><div><h3>' + escapeHtml(projectName) + ' ready</h3><p>This token is shown once and will not be shown again. Copy it now, then open quickstart to finish the first browser integration. This card stays visible until you dismiss it.</p></div><button class="ds-button ds-button-secondary" type="button" data-dismiss-provision>Dismiss</button></div>' +
              '<div class="token-card"><span>Issued token</span><code>' + escapeHtml(token) + '</code><button class="ds-button ds-button-secondary" type="button" data-copy-value="' + escapeHtml(token) + '">Copy token</button></div>' +
              '<div class="card-actions wrap">' +
                (projectId ? '<a class="ds-button ds-button-secondary" href="/app/projects/' + encodeURIComponent(projectId) + '">Open project</a>' : '') +
                '<a class="ds-button ds-button-secondary" href="/docs/quickstart">Open quickstart</a>' +
              '</div>' +
            '</article>' +
            snippetMarkup(snippets);
        }

        function bindSnippetCards(root) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-snippet-card]"), function (card) {
            const queryCode = card.getAttribute("data-query-code") || "";
            const headerCode = card.getAttribute("data-header-code") || "";
            const preferredMode = card.getAttribute("data-preferred-mode") || "query";
            const codeNode = card.querySelector("[data-snippet-code]");
            const buttons = card.querySelectorAll("[data-snippet-mode]");
            function setMode(mode) {
              if (!codeNode) {
                return;
              }
              codeNode.textContent = mode === "header" ? headerCode : queryCode;
              Array.prototype.forEach.call(buttons, function (button) {
                button.classList.toggle("active", button.getAttribute("data-snippet-mode") === mode);
              });
            }
            Array.prototype.forEach.call(buttons, function (button) {
              button.addEventListener("click", function () {
                const mode = button.getAttribute("data-snippet-mode") === "header" ? "header" : "query";
                setMode(mode);
              });
            });
            const copyButton = card.querySelector("[data-copy-snippet]");
            if (copyButton) {
              copyButton.addEventListener("click", async function () {
                const text = codeNode ? codeNode.textContent || "" : "";
                const copied = await copyText(text);
                copyButton.textContent = copied ? "Copied" : "Copy failed";
                window.setTimeout(function () {
                  copyButton.textContent = "Copy snippet";
                }, 1200);
              });
            }
            setMode(preferredMode === "header" ? "header" : "query");
          });
        }

        function bindCopyValueButtons(root) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-copy-value]"), function (button) {
            if (button.getAttribute("data-copy-bound") === "true") {
              return;
            }
            button.setAttribute("data-copy-bound", "true");
            button.addEventListener("click", async function () {
              const value = button.getAttribute("data-copy-value") || "";
              const previous = button.textContent;
              const copied = await copyText(value);
              button.textContent = copied ? "Copied" : "Copy failed";
              window.setTimeout(function () {
                button.textContent = previous || "Copy";
              }, 1200);
            });
          });
        }

        function bindProvisionResultCards(root) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-provision-result-card]"), function (card) {
            const dismissButton = card.querySelector("[data-dismiss-provision]");
            if (!dismissButton || dismissButton.getAttribute("data-dismiss-bound") === "true") {
              return;
            }
            dismissButton.setAttribute("data-dismiss-bound", "true");
            dismissButton.addEventListener("click", function () {
              card.remove();
            });
          });
        }

        function bindStylePreviews(root) {
          Array.prototype.forEach.call(root.querySelectorAll("[data-style-preview-image]"), function (previewImage) {
            previewImage.addEventListener("error", function () {
              const frame = previewImage.closest("[data-style-preview-frame]");
              const errorState = frame ? frame.querySelector("[data-style-preview-error]") : null;
              const previewCard = previewImage.closest(".style-preview-card");
              const status = previewCard ? previewCard.querySelector("[data-style-preview-status]") : null;
              previewImage.setAttribute("hidden", "hidden");
              if (errorState) {
                errorState.removeAttribute("hidden");
              }
              if (status) {
                status.textContent = "Preview failed to load";
                status.classList.remove("chip-live");
                status.classList.add("chip-muted");
              }
            });
          });
        }

        bindSnippetCards(document);
        bindCopyValueButtons(document);
        bindProvisionResultCards(document);
        bindStylePreviews(document);

        const rotateDialog = document.querySelector("[data-rotate-confirm-dialog]");
        const rotateConfirm = rotateDialog ? rotateDialog.querySelector("[data-rotate-confirm]") : null;
        const rotateCancel = rotateDialog ? rotateDialog.querySelector("[data-rotate-cancel]") : null;
        const rotateClose = rotateDialog ? rotateDialog.querySelector("[data-rotate-close]") : null;
        let pendingRotation = null;

        function closeRotateDialog() {
          pendingRotation = null;
          if (!rotateDialog) {
            return;
          }
          rotateDialog.setAttribute("hidden", "hidden");
          rotateDialog.setAttribute("aria-hidden", "true");
          document.body.classList.remove("modal-open");
        }

        function openRotateDialog(endpoint, targetId) {
          pendingRotation = {
            endpoint: endpoint,
            targetId: targetId
          };
          if (!rotateDialog) {
            return;
          }
          rotateDialog.removeAttribute("hidden");
          rotateDialog.setAttribute("aria-hidden", "false");
          document.body.classList.add("modal-open");
        }

        if (rotateCancel) {
          rotateCancel.addEventListener("click", closeRotateDialog);
        }
        if (rotateClose) {
          rotateClose.addEventListener("click", closeRotateDialog);
        }
        if (rotateDialog) {
          rotateDialog.addEventListener("click", function (event) {
            if (event.target === rotateDialog) {
              closeRotateDialog();
            }
          });
        }
        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape") {
            closeRotateDialog();
          }
        });

        const createForm = document.querySelector("[data-project-create-form]");
        if (createForm) {
          createForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const statusNode = createForm.querySelector("[data-form-status]");
            const resultNode = document.getElementById("project-create-result");
            setStatus(statusNode, "Creating project...", false);
            const nameNode = createForm.querySelector('input[name="name"]');
            const originsNode = createForm.querySelector('textarea[name="allowedOrigins"]');
            const tilesNode = createForm.querySelector('input[name="tiles"]');
            const rasterNode = createForm.querySelector('input[name="raster"]');
            const staticNode = createForm.querySelector('input[name="staticMaps"]');
            const payload = {
              name: nameNode && "value" in nameNode ? String(nameNode.value).trim() : "",
              allowedOrigins: normalizeOrigins(originsNode && "value" in originsNode ? originsNode.value : ""),
              allowedEndpoints: {
                tiles: Boolean(tilesNode && "checked" in tilesNode && tilesNode.checked),
                raster: Boolean(rasterNode && "checked" in rasterNode && rasterNode.checked),
                staticMaps: Boolean(staticNode && "checked" in staticNode && staticNode.checked)
              }
            };
            const result = await requestJson("/app-api/projects", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Project creation failed", true);
              return;
            }
            setStatus(statusNode, "Project created. Copy the token now, then open quickstart.", false);
            if (resultNode) {
              resultNode.innerHTML = provisionMarkup(data);
              bindSnippetCards(resultNode);
              bindCopyValueButtons(resultNode);
              bindProvisionResultCards(resultNode);
            }
          });
        }

        Array.prototype.forEach.call(document.querySelectorAll("[data-project-update-form]"), function (form) {
          form.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = form.getAttribute("data-project-endpoint") || "";
            const statusNode = form.querySelector("[data-form-status]");
            setStatus(statusNode, "Saving settings...", false);
            const nameNode = form.querySelector('input[name="name"]');
            const originsNode = form.querySelector('textarea[name="allowedOrigins"]');
            const tilesNode = form.querySelector('input[name="tiles"]');
            const rasterNode = form.querySelector('input[name="raster"]');
            const staticNode = form.querySelector('input[name="staticMaps"]');
            const result = await requestJson(endpoint, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                name: nameNode && "value" in nameNode ? String(nameNode.value).trim() : "",
                allowedOrigins: normalizeOrigins(originsNode && "value" in originsNode ? originsNode.value : ""),
                allowedEndpoints: {
                  tiles: Boolean(tilesNode && "checked" in tilesNode && tilesNode.checked),
                  raster: Boolean(rasterNode && "checked" in rasterNode && rasterNode.checked),
                  staticMaps: Boolean(staticNode && "checked" in staticNode && staticNode.checked)
                }
              })
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Save failed", true);
              return;
            }
            setStatus(statusNode, "Settings saved.", false);
          });
        });

        Array.prototype.forEach.call(document.querySelectorAll("[data-settings-form]"), function (form) {
          form.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = form.getAttribute("data-settings-endpoint") || "";
            const statusNode = form.querySelector("[data-form-status]");
            setStatus(statusNode, "Saving workspace...", false);
            const workspaceName = form.querySelector('input[name="workspaceName"]');
            const result = await requestJson(endpoint, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                workspaceName: workspaceName && "value" in workspaceName ? String(workspaceName.value).trim() : ""
              })
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Save failed", true);
              return;
            }
            setStatus(statusNode, "Workspace updated.", false);
          });
        });

        Array.prototype.forEach.call(document.querySelectorAll("[data-rotate-endpoint]"), function (button) {
          button.addEventListener("click", function () {
            const endpoint = button.getAttribute("data-rotate-endpoint") || "";
            const targetId = button.getAttribute("data-result-target") || "";
            openRotateDialog(endpoint, targetId);
          });
        });

        if (rotateConfirm) {
          rotateConfirm.addEventListener("click", async function () {
            if (!pendingRotation) {
              closeRotateDialog();
              return;
            }
            const endpoint = pendingRotation.endpoint || "";
            const targetId = pendingRotation.targetId || "";
            const resultNode = targetId ? document.getElementById(targetId) : null;
            closeRotateDialog();
            const result = await requestJson(endpoint, { method: "POST" });
            const data = result.data;
            if (!result.ok) {
              if (resultNode) {
                resultNode.innerHTML = '<article class="banner banner-danger"><div><strong>Rotation failed</strong><p>' + escapeHtml(data && data.error ? String(data.error) : "Unknown error") + '</p></div></article>';
              }
              return;
            }
            if (resultNode) {
              resultNode.innerHTML = provisionMarkup(data);
              bindSnippetCards(resultNode);
              bindCopyValueButtons(resultNode);
              bindProvisionResultCards(resultNode);
            }
          });
        }

        async function runStripe(endpoint, payload, statusNode) {
          setStatus(statusNode, "Opening Stripe...", false);
          const result = await requestJson(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = result.data;
          if (!result.ok || !data || typeof data.url !== "string") {
            setStatus(statusNode, data && data.error ? String(data.error) : "Stripe session creation failed", true);
            return;
          }
          window.location.href = data.url;
        }

        const billingStatus = document.getElementById("billing-status");
        Array.prototype.forEach.call(document.querySelectorAll("[data-billing-endpoint]"), function (button) {
          button.addEventListener("click", function () {
            const endpoint = button.getAttribute("data-billing-endpoint") || "";
            const planId = button.getAttribute("data-billing-plan") || "pro";
            void runStripe(endpoint, {
              planId: planId,
              successUrl: window.location.origin + "/app/billing?checkout=success",
              cancelUrl: window.location.origin + "/app/billing?checkout=cancel"
            }, billingStatus);
          });
        });

        const autoOpenCheckout = document.querySelector("[data-billing-auto-open='true']");
        if (autoOpenCheckout && "click" in autoOpenCheckout) {
          window.setTimeout(function () {
            autoOpenCheckout.click();
          }, 80);
        }

        Array.prototype.forEach.call(document.querySelectorAll("[data-portal-endpoint]"), function (button) {
          button.addEventListener("click", function () {
            const endpoint = button.getAttribute("data-portal-endpoint") || "";
            void runStripe(endpoint, {
              returnUrl: window.location.origin + window.location.pathname
            }, billingStatus);
          });
        });

        const inviteForm = document.querySelector("[data-invite-form]");
        if (inviteForm) {
          inviteForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = inviteForm.getAttribute("data-invite-endpoint") || "";
            const statusNode = inviteForm.querySelector("[data-invite-status]");
            setStatus(statusNode, "Sending invitation...", false);
            const emailNode = inviteForm.querySelector('input[name="email"]');
            const roleNode = inviteForm.querySelector('select[name="role"]');
            const payload = {
              email: emailNode && "value" in emailNode ? String(emailNode.value).trim() : "",
              role: roleNode && "value" in roleNode ? String(roleNode.value).trim() : "member"
            };
            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Invitation failed", true);
              return;
            }
            setStatus(statusNode, "Invitation sent.", false);
            if (emailNode && "value" in emailNode) {
              emailNode.value = "";
            }
            window.setTimeout(function () {
              window.location.reload();
            }, 1000);
          });
        }

        Array.prototype.forEach.call(document.querySelectorAll("[data-remove-member-button]"), function (button) {
          button.addEventListener("click", async function () {
            const userId = button.getAttribute("data-remove-member-button");
            if (!window.confirm("Remove " + userId + " from this workspace? Access ends immediately. An owner can invite this person again later.")) {
              return;
            }
            const endpoint = button.getAttribute("data-remove-member-endpoint") || "";
            button.disabled = true;
            const result = await requestJson(endpoint, {
              method: "POST"
            });
            const data = result.data;
            if (!result.ok) {
              window.alert(data && data.error ? String(data.error) : "Failed to remove member");
              button.disabled = false;
              return;
            }
            window.location.reload();
          });
        });

        const disableMfaTrigger = document.querySelector("[data-disable-mfa-trigger]");
        const disableMfaDialog = document.querySelector("[data-disable-mfa-dialog]");
        const disableMfaForm = document.querySelector("[data-disable-mfa-form]");
        const disableMfaCancel = document.querySelector("[data-disable-mfa-cancel]");

        if (disableMfaTrigger && disableMfaDialog) {
          disableMfaTrigger.addEventListener("click", function () {
            disableMfaDialog.removeAttribute("hidden");
            disableMfaDialog.setAttribute("aria-hidden", "false");
            document.body.classList.add("modal-open");
          });
        }
        if (disableMfaCancel && disableMfaDialog) {
          disableMfaCancel.addEventListener("click", function () {
            disableMfaDialog.setAttribute("hidden", "hidden");
            disableMfaDialog.setAttribute("aria-hidden", "true");
            document.body.classList.remove("modal-open");
          });
        }
        if (disableMfaForm && disableMfaDialog) {
          disableMfaForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = disableMfaForm.getAttribute("data-disable-mfa-endpoint") || "";
            const statusNode = disableMfaForm.querySelector("[data-disable-mfa-status]");
            setStatus(statusNode, "Disabling MFA...", false);
            const passwordNode = disableMfaForm.querySelector('input[name="password"]');
            const payload = {
              password: passwordNode && "value" in passwordNode ? String(passwordNode.value) : ""
            };
            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Failed to disable MFA", true);
              return;
            }
            setStatus(statusNode, "MFA disabled. Reloading...", false);
            window.setTimeout(function () {
              window.location.reload();
            }, 1000);
          });
        }

        const mfaStart = document.querySelector("[data-mfa-start]");
        const mfaStartStatus = document.querySelector("[data-mfa-start-status]");
        const mfaSetupIntro = document.querySelector("[data-mfa-setup-intro]");
        const mfaStartActions = document.querySelector("[data-mfa-start-actions]");
        const mfaSecretPanel = document.querySelector("[data-mfa-secret-panel]");
        const mfaSecretNode = document.querySelector("[data-mfa-secret]");
        const mfaSecretCopy = document.querySelector("[data-mfa-secret-copy]");
        const mfaRecoveryPanel = document.querySelector("[data-mfa-recovery-panel]");
        const mfaRecoveryCodes = document.querySelector("[data-mfa-recovery-codes]");
        const mfaRecoveryCopy = document.querySelector("[data-mfa-recovery-copy]");
        let currentMfaSecret = "";
        let currentMfaRecoveryCodes = [];

        if (mfaStart) {
          mfaStart.addEventListener("click", async function () {
            const endpoint = mfaStart.getAttribute("data-mfa-enroll-endpoint") || "";
            mfaStart.disabled = true;
            setStatus(mfaStartStatus, "Creating MFA secret...", false);
            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}"
            });
            const data = result.data;
            const secret = data && typeof data.secret === "string" ? data.secret : "";
            const recoveryCodes = data && Array.isArray(data.recoveryCodes)
              ? data.recoveryCodes.filter(function (code) { return typeof code === "string"; })
              : [];
            if (!result.ok || !secret || recoveryCodes.length === 0) {
              setStatus(mfaStartStatus, data && data.error ? String(data.error) : "MFA setup could not be started", true);
              mfaStart.disabled = false;
              return;
            }
            currentMfaSecret = secret;
            currentMfaRecoveryCodes = recoveryCodes;
            if (mfaSecretNode) {
              mfaSecretNode.textContent = secret;
            }
            if (mfaRecoveryCodes) {
              mfaRecoveryCodes.textContent = "";
              recoveryCodes.forEach(function (code) {
                const codeNode = document.createElement("code");
                codeNode.textContent = code;
                mfaRecoveryCodes.appendChild(codeNode);
              });
            }
            if (mfaSetupIntro) mfaSetupIntro.setAttribute("hidden", "hidden");
            if (mfaStartActions) mfaStartActions.setAttribute("hidden", "hidden");
            if (mfaSecretPanel) mfaSecretPanel.removeAttribute("hidden");
            if (mfaRecoveryPanel) mfaRecoveryPanel.removeAttribute("hidden");
            const enrollForm = document.querySelector("[data-mfa-enroll-form]");
            if (enrollForm) enrollForm.removeAttribute("hidden");
            setStatus(mfaStartStatus, "Secret created. Save the recovery codes, then verify the six-digit code.", false);
          });
        }
        if (mfaSecretCopy) {
          mfaSecretCopy.addEventListener("click", async function () {
            const copied = await copyText(currentMfaSecret);
            mfaSecretCopy.textContent = copied ? "Copied" : "Copy failed";
          });
        }
        if (mfaRecoveryCopy) {
          mfaRecoveryCopy.addEventListener("click", async function () {
            const copied = await copyText(currentMfaRecoveryCodes.join("\n"));
            mfaRecoveryCopy.textContent = copied ? "Copied" : "Copy failed";
          });
        }

        const mfaEnrollForm = document.querySelector("[data-mfa-enroll-form]");
        if (mfaEnrollForm) {
          mfaEnrollForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = mfaEnrollForm.getAttribute("data-mfa-enroll-endpoint") || "";
            const statusNode = mfaEnrollForm.querySelector("[data-mfa-enroll-status]");
            setStatus(statusNode, "Enrolling MFA...", false);
            const codeNode = mfaEnrollForm.querySelector('input[name="code"]');
            const payload = {
              code: codeNode && "value" in codeNode ? String(codeNode.value).trim() : ""
            };
            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "MFA enrollment failed", true);
              return;
            }
            setStatus(statusNode, "MFA enabled. Redirecting...", false);
            window.setTimeout(function () {
              window.location.href = "/app/settings/security";
            }, 1000);
          });
        }

        const passwordChangeForm = document.querySelector("[data-password-change-form]");
        if (passwordChangeForm) {
          passwordChangeForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = passwordChangeForm.getAttribute("data-password-change-endpoint") || "";
            const statusNode = passwordChangeForm.querySelector("[data-password-change-status]");
            setStatus(statusNode, "Updating password...", false);
            const currentPasswordNode = passwordChangeForm.querySelector('input[name="currentPassword"]');
            const newPasswordNode = passwordChangeForm.querySelector('input[name="newPassword"]');
            const payload = {
              currentPassword: currentPasswordNode && "value" in currentPasswordNode ? String(currentPasswordNode.value) : "",
              newPassword: newPasswordNode && "value" in newPasswordNode ? String(newPasswordNode.value) : ""
            };
            const result = await requestJson(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload)
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Password update failed", true);
              return;
            }
            setStatus(statusNode, "Password updated.", false);
            if (currentPasswordNode && "value" in currentPasswordNode) {
              currentPasswordNode.value = "";
            }
            if (newPasswordNode && "value" in newPasswordNode) {
              newPasswordNode.value = "";
            }
            window.setTimeout(function () {
              window.location.href = "/app/settings/security";
            }, 1000);
          });
        }

        const exportTriggerBtn = document.querySelector("[data-export-trigger-btn]");
        if (exportTriggerBtn) {
          exportTriggerBtn.addEventListener("click", async function () {
            const endpoint = exportTriggerBtn.getAttribute("data-export-endpoint") || "";
            const statusNode = document.querySelector("[data-export-status]");
            exportTriggerBtn.disabled = true;
            setStatus(statusNode, "Requesting data export...", false);
            const result = await requestJson(endpoint, {
              method: "POST"
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Failed to trigger export", true);
              exportTriggerBtn.disabled = false;
              return;
            }
            setStatus(statusNode, "Export requested. A download link will be sent by email when it is ready.", false);
          });
        }

        const deleteWorkspaceForm = document.querySelector("[data-delete-workspace-form]");
        if (deleteWorkspaceForm) {
          const emailInput = deleteWorkspaceForm.querySelector('input[name="confirmEmail"]');
          const submitBtn = deleteWorkspaceForm.querySelector("[data-delete-submit-btn]");
          const statusNode = deleteWorkspaceForm.querySelector("[data-delete-status]");
          if (emailInput && submitBtn) {
            const emailToMatch = emailInput.getAttribute("placeholder") || "";
            emailInput.addEventListener("input", function () {
              const matches = emailInput.value.trim() === emailToMatch.trim();
              submitBtn.disabled = !matches;
            });
          }
          deleteWorkspaceForm.addEventListener("submit", async function (event) {
            event.preventDefault();
            const endpoint = deleteWorkspaceForm.getAttribute("data-delete-workspace-endpoint") || "";
            setStatus(statusNode, "Scheduling workspace deletion...", false);
            submitBtn.disabled = true;
            const result = await requestJson(endpoint, {
              method: "POST"
            });
            const data = result.data;
            if (!result.ok) {
              setStatus(statusNode, data && data.error ? String(data.error) : "Failed to delete workspace", true);
              submitBtn.disabled = false;
              return;
            }
            setStatus(statusNode, "Workspace scheduled for deletion. Access has ended. Redirecting...", false);
            window.setTimeout(function () {
              window.location.href = "/sign-up";
            }, 1000);
          });
        }
      })();
    </script>
  `;
}
