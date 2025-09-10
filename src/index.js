// window.OhGoodPay = { init() -> { mount(), start() } }
// style.css 파일을 적용하려면, index.html에서 <link rel="stylesheet" href="style.css" />를 주석 해제하거나,
// JS에서 동적으로 style.css를 불러올 수 있습니다.
// 아래 코드는 JS에서 style.css를 동적으로 불러오는 방법입니다.

(function loadStyle() {
  // 이미 style.css가 로드되어 있는지 확인
  if (!document.querySelector('link[href="style.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "style.css";
    document.head.appendChild(link);
  }
})();

(function () {
  function init(_opts) {
    let mountedEl = null;
    let state = {
      qrCode: null, // { paymentRequestId, qrImageUrl, expiresAt }
      pinCode: null, // { paymentRequestId, pinCode, expiresAt }
      orderId: null,
      requestName: null,
      pollingHandle: null,
      paymentRequestId: null,
    };

    function mount(selector) {
      mountedEl = document.querySelector(selector);
      if (!mountedEl) throw new Error("mount 대상이 없음");
      mountedEl.innerHTML = `
          <div class="ogp-card">
            <div class="ogp-title">OhGoodPay</div>
            <div id="ogp-body">
              <div class="ogp-grid">
                <div class="ogp-panel" id="ogp-qr-panel">
                  <h4>QR로 결제</h4>
                  <div id="ogp-qr-loading">QR 생성 중...</div>
                </div>
                <div class="ogp-panel" id="ogp-pin-panel">
                  <h4>PIN으로 결제</h4>
                  <div id="ogp-pin-loading">PIN 생성 중...</div>
                </div>
              </div>
              <div class="ogp-desc" style="margin-top:10px">
                두 방법 중 <b>하나</b>만 완료해도 결제가 진행됩니다.
              </div>
            </div>
            <div class="ogp-footer">
              <span class="ogp-badgelite" id="ogp-exp-badge">만료 대기...</span>
              <button id="ogp-close" class="ogp-btn">닫기</button>
            </div>
          </div>`;
      mountedEl.querySelector("#ogp-close").onclick = onClose;
    }

    async function start(opts) {
      if (!mountedEl) throw new Error("먼저 mount() 하세요.");
      const orderId = opts.orderId;
      const totalPrice = opts.totalPrice;
      const requestName = opts.requestName;
      state.orderId = orderId;

      // QR & PIN을 동시에 생성 (API 두 번 호출)
      const result = await Promise.allSettled([
        createCode({ orderId, totalPrice, requestName }),
      ]);
      console.log(result);
      const paymentRequestId = result[0].value.paymentRequestId;
      state.paymentRequestId = paymentRequestId;
      const qrImageUrl = result[0].value.qrImageUrl;
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 현재 시간 + 2분
      const pinCode = result[0].value.pinCode;
      // const pinExpiresAt = result[0].value.pinExpiresAt;

      const qrPanel = mountedEl.querySelector("#ogp-qr-panel");
      const pinPanel = mountedEl.querySelector("#ogp-pin-panel");
      const expBadge = mountedEl.querySelector("#ogp-exp-badge");

      // QR 렌더
      if (result[0].status === "fulfilled" && result[0].value.success) {
        state.qrCode = {
          paymentRequestId: result[0].value.paymentRequestId,
          qrImageUrl: result[0].value.qrImageUrl,
          // expiresAt: result[0].value.expiresAt,
        };
        const q = state.qrCode;
        qrPanel.innerHTML = `
            <h4>QR로 결제</h4>
            <img class="ogp-qr" src="${q.qrImageUrl}" alt="결제 QR" />`;
      } else {
        qrPanel.innerHTML = `<h4>QR로 결제</h4><div class="ogp-desc">QR 생성 실패</div>`;
      }

      // PIN 렌더
      if (result[0].status === "fulfilled" && result[0].value.success) {
        state.pinCode = {
          paymentRequestId: result[0].value.paymentRequestId,
          pinCode: result[0].value.pinCode,
          // expiresAt: pinRes.value.expiresAt,
        };
        const p = state.pinCode;
        pinPanel.innerHTML = `
            <h4>PIN으로 결제</h4>
            <div class="ogp-pin">${p.pinCode}</div>`;
      } else {
        pinPanel.innerHTML = `<h4>PIN으로 결제</h4><div class="ogp-desc">PIN 생성 실패</div>`;
      }

      // 만료 뱃지(둘 중 더 이른 만료 시간 표시)
      // const expires = [state.qrCode?.expiresAt, state.pinCode?.expiresAt]
      //   .filter(Boolean)
      //   .map((x) => new Date(x));
      // if (expires.length) {
      //   const earliest = new Date(Math.min.apply(null, expires));
      //   expBadge.textContent = `가장 빠른 만료: ${earliest.toLocaleString()}`;
      // } else {
      //   expBadge.textContent = `발급 실패`;
      // }

      // 결과 폴링 (둘 중 무엇이든 결제되면 완료)
      await pollUntilDone(orderId);
    }

    async function createCode({ orderId, totalPrice, requestName }) {
      const idem =
        crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + Math.random();
      const r = await fetch("http://localhost:8080/api/payment/requestment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idem,
        },
        body: JSON.stringify({ orderId, totalPrice, requestName }),
      });
      if (!r.ok) throw new Error("코드 발급 실패");
      return r.json(); // { success, paymentRequestId, orderId, qrImageUrl|pinCode, expiresAt }
    }

    async function onClose() {
      // 만료 처리: 두 코드 모두 시도

      const r = await fetch(
        "http://localhost:8080/api/payment/expiration/" +
          encodeURIComponent(state.paymentRequestId),
        {
          method: "POST",
        }
      );
      if (!r.ok) throw new Error("만료 처리 실패");

      if (state.pollingHandle) clearInterval(state.pollingHandle);
      mountedEl.innerHTML = "";
    }

    async function pollUntilDone(orderId) {
      const bodyEl = mountedEl.querySelector("#ogp-body");
      return new Promise(function (resolve, reject) {
        let elapsed = 0;
        state.pollingHandle = setInterval(async function () {
          try {
            elapsed += 1500;
            const res = await fetch(
              "http://localhost:8080/api/payment/check/" +
                encodeURIComponent(state.orderId),
              {
                method: "GET",
              }
            );
            if (!res.ok) return;
            const s = await res.json(); // { success, result?: boolean }
            if (s.success && typeof s.result === "boolean") {
              clearInterval(state.pollingHandle);
              if (s.result) {
                bodyEl.insertAdjacentHTML(
                  "beforeend",
                  `<div class="ogp-desc" style="margin-top:8px">결제 완료</div>`
                );
                resolve();
              } else {
                onClose();
                reject(new Error("결제 실패"));
              }
            }
            if (elapsed > 120000) {
              // 2분
              clearInterval(state.pollingHandle);
              onClose();
              reject(new Error("결제 시간 초과"));
            }
          } catch (e) {
            /* 네트워크 일시 오류는 재시도 */
          }
        }, 1500);
      });
    }

    return { mount, start };
  }

  window.OhGoodPay = { init: init };
})();
