// window.OhGoodPay = { init() -> { mount(), start() } }
// style.css 파일을 적용하려면, index.html에서 <link rel="stylesheet" href="style.css" />를 주석 해제하거나,
// JS에서 동적으로 style.css를 불러올 수 있습니다.
// 아래 코드는 JS에서 style.css를 동적으로 불러오는 방법입니다.

(function loadStyle() {
  // 이미 style.css가 로드되어 있는지 확인
  if (
    !document.querySelector(
      'link[href="https://ohgoodpay.s3.ap-northeast-2.amazonaws.com/sdk/style.min.css"]'
    )
  ) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://ohgoodpay.s3.ap-northeast-2.amazonaws.com/sdk/style.min.css";
    document.head.appendChild(link);
  }
})();

// import "./style.css";

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
      payResult: false,
      manualCheckResolve: null,
    };

    // HTML에서 API base URL 가져오기
    function getApiBaseUrl() {
      const script = document.querySelector(
        'script[src="https://ohgoodpay.s3.ap-northeast-2.amazonaws.com/sdk/pay.min.js"]'
      );
      const apiBaseUrl = script
        ? script.getAttribute("data-api-base-url")
        : null;
      if (!apiBaseUrl) {
        throw new Error("data-api-base-url 속성이 설정되지 않았습니다.");
      }
      return apiBaseUrl;
    }

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
                <span>* 코드 유효 시간은 2분입니다.</span>
                <span>* 결제를 마치면 창이 자동으로 닫힙니다.</span>
                <span>* 결제 완료 후 창이 닫히지 않으면 결제 완료를 눌러주세요.</span>
              </div>
            </div>
            <div class="ogp-footer">
              <button id="ogp-check-btn" class="ogp-btn">결제 완료</button>
              <button id="ogp-close" class="ogp-btn">닫기</button>
            </div>
          </div>`;
      mountedEl.querySelector("#ogp-close").onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      };
      mountedEl.querySelector("#ogp-check-btn").onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        onCheck();
      };
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
        };
        const q = state.qrCode;
        qrPanel.innerHTML = `
          <h4>QR로 결제</h4>
          <img class="ogp-qr" src="${q.qrImageUrl}" alt="결제 QR" />
        `;
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
      try {
        // 폴링과 수동 확인 중 하나가 완료되면 종료
        await Promise.race([
          pollUntilDone(orderId),
          new Promise((resolve) => {
            state.manualCheckResolve = resolve;
          }),
        ]);
        onClose();
        return state.payResult;
      } catch (error) {
        console.error("결제 폴링 중 오류:", error);
        onClose();
        return false;
      }
    }

    async function createCode({ orderId, totalPrice, requestName }) {
      const idem =
        crypto && crypto.randomUUID
          ? crypto.randomUUID()
          : String(Date.now()) + Math.random();
      const apiBaseUrl = getApiBaseUrl();
      const r = await fetch(`${apiBaseUrl}/api/public/payment/requestment`, {
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
      const apiBaseUrl = getApiBaseUrl();
      const r = await fetch(
        `${apiBaseUrl}/api/public/payment/expiration/` +
          encodeURIComponent(state.paymentRequestId),
        {
          method: "POST",
        }
      );
      if (!r.ok) throw new Error("만료 처리 실패");

      if (state.pollingHandle) clearInterval(state.pollingHandle);
      mountedEl.innerHTML = "";
    }

    async function onCheck() {
      try {
        const apiBaseUrl = getApiBaseUrl();
        const res = await fetch(
          `${apiBaseUrl}/api/public/payment/check/` +
            encodeURIComponent(state.orderId),
          {
            method: "GET",
          }
        );
        if (!res.ok) throw new Error("결제 확인 실패");
        const s = await res.json(); // { success, result?: boolean }
        if (s.success && typeof s.result === "boolean") {
          if (s.result) {
            state.payResult = true;
            // 폴링 중단
            if (state.pollingHandle) {
              clearInterval(state.pollingHandle);
              state.pollingHandle = null;
            }
            // 결제 완료 시에는 UI만 정리 (만료 처리 API 호출 안함)
            if (mountedEl) {
              mountedEl.innerHTML = "";
            }
            // 수동 확인 완료 신호
            if (state.manualCheckResolve) {
              state.manualCheckResolve();
            }
          } else {
            state.payResult = false;
            // 결제 실패 시에는 만료 처리
            // 수동 확인 완료 신호
            if (state.manualCheckResolve) {
              state.manualCheckResolve();
            }
          }
        } else {
          state.payResult = false;
          // 결제 실패 시에는 만료 처리
          // 수동 확인 완료 신호
          if (state.manualCheckResolve) {
            state.manualCheckResolve();
          }
        }
      } catch (e) {
        state.payResult = false;
        alert("결제 확인 중 오류가 발생했습니다.");
        // 오류 시에는 만료 처리
        // 수동 확인 완료 신호
        if (state.manualCheckResolve) {
          state.manualCheckResolve();
        }
      }
    }

    async function pollUntilDone(orderId) {
      const bodyEl = mountedEl.querySelector("#ogp-body");
      return new Promise(function (resolve, reject) {
        let elapsed = 0;
        state.pollingHandle = setInterval(async function () {
          try {
            elapsed += 1500;
            const apiBaseUrl = getApiBaseUrl();
            const res = await fetch(
              `${apiBaseUrl}/api/public/payment/check/` +
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
                state.payResult = true;
                resolve();
              } else {
                clearInterval(state.pollingHandle);
                state.payResult = false;
                onClose();
                reject(new Error("결제 실패"));
              }
            }
            if (elapsed > 120000) {
              // 2분
              clearInterval(state.pollingHandle);
              state.payResult = false;
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
