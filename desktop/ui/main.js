const form = document.querySelector("#connect-form");
const host = document.querySelector("#host");
const button = document.querySelector("#connect");
const status = document.querySelector("#status");

function invoke(channel, payload) {
  if (!window.vay) {
    return Promise.reject(new Error("Open this screen in Vay Tutor Client."));
  }
  if (channel === "saved_host") return window.vay.savedHost();
  return window.vay.connect(payload.url);
}

function text(error) {
  if (typeof error === "string") return error;
  return error && error.message ? error.message : String(error);
}

function show(message, failed) {
  status.textContent = message;
  status.classList.toggle("error", failed);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  button.disabled = true;
  show("Checking the host...", false);
  try {
    const result = await invoke("connect", { url: host.value });
    if (!result.ok) throw new Error(result.error);
    show("Opening the host...", false);
  } catch (error) {
    show(text(error), true);
    button.disabled = false;
  }
});

invoke("saved_host")
  .then((saved) => {
    if (saved) host.value = saved;
  })
  .catch(() => {});
