var app = new Vue({
  el: '#app',
  data: {
    update_failure_reason: '',
    platform_description: '',
    webauthn_support: '',
    what_is_it: '',
    solo_version_parts: null,
    solo_version: null,
    stable_version_parts: null,
    stable_version: null,
    is_solo_secure: null,
    is_solo_hacker: null,
    needs_update: false,
    ask_for_attestation: null,
    correct_firmware: true,
    signed_firmware: null,
    update_status: null,
    update_progress: null,
    advanced_mode: false,
    show_advanced_mode: false,
    cannot_inspect: null,
    cannot_flash: null,
    bootloader_called: null,
    update_success: null,
    update_failure: null,
    about_to_flash: null,
    p_progress: null,
    is_linux: null,
    is_not_supported_configuration: null,
    user_selected_device: '',
    supported_devices: supported_devices,
    update_ongoing: false,
    reply_wait: 0,
    cancel_animation: true,
    app_step: const_app_steps.not_set,
    const_app_steps: const_app_steps,
    bootloader_version: '',
    bootloader_pubkey: '',
    device_state: const_device_state.not_set,
    const_device_state: const_device_state,
    const_app_steps_strings: const_app_steps_strings,
    solo_version_str: '',
    bootloader_execution_attempt: 0,
  }
});

async function reset_messages() {
  app.cannot_inspect = null;
  app.cannot_flash = null;
  app.bootloader_called = null;
  app.update_success = null;
  app.update_failure = null;
  app.update_progress = null;
  app.ask_for_attestation = null;
  app.update_ongoing = false;
}

async function sleep(delay) {
  return new Promise(function (resolve) {
    setTimeout(resolve, delay);
  });
}

async function toggle_advanced_mode2() {
  app.show_advanced_mode = !app.show_advanced_mode;
}

async function toggle_advanced_mode() {
  app.advanced_mode = !app.advanced_mode;
}

async function inspect_browser() {
  app.platform_description = platform.description;
  if (!window.PublicKeyCredential) {
    app.webauthn_support = "(unsupported; your browser does not support WebAuthn, please use another one)";
  } else {
    app.webauthn_support = "(WebAuthn supported)";
  }
  if (platform.os["family"] === "Linux") {
    app.is_linux = true;
  }
  if (platform.name === "Chrome" && platform.os["family"] !== "Windows" || platform.name === "Safari"
  ){
    app.is_not_supported_configuration = true;
  }
}

async function run_bootloader() {

  await ctaphid_via_webauthn(
    CMD.solo_bootloader, null, null, 1000
  ).then(response => {
      console.log("bootloader RESPONSE", response);
      // FIXME handle failure in call
      app.cannot_flash = null;
      app.bootloader_called = true;
      app.app_step = const_app_steps.bootloader_executed;
    }
  )
    .catch(error => {
      console.log(error);
    });

}

async function exit_bootloader() {
  let signed_firmware = await fetch_firmware();
  let signature = signed_firmware.signature;

  await ctaphid_via_webauthn(
    CMD.boot_done, 0x8000, signature
  ).then(response => {
      console.log("bootloader RESPONSE", response);
      app.bootloader_called = false;
      app.app_step = const_app_steps.not_set;
    }
  )
    .catch(error => {
      console.log(error);
    });
}

async function check_version() {
  await ctaphid_via_webauthn(
    // option a) timeout --> leads to ugly persistent popup in chrome (firefox is better)
    CMD.solo_version, null, null, 1000
    // option b) no timeout --> user needs to click cancel
    // CMD.solo_version,
  ).then(response => {
      console.log("check-version RESPONSE", response);
      if (response && typeof response !== "undefined") {
        app.solo_version_parts = response.slice(0, 3);
        app.solo_version = response[0] + '.' + response[1] + '.' + response[2];
        app.solo_version_str = '';
        app.device_state = const_device_state.normal_mode;
        app.is_solo_secure = true;
      } else {
        // we assume this is a pre-1.1.0 solo
        app.solo_version_parts = new Uint8Array([0, 0, 0]);
        app.solo_version = "unknown";
      }
    }
  )
    .catch(error => {
      console.log(error);
    });
}

async function fetch_stable_version() {
  var response = await fetch(
    "https://raw.githubusercontent.com/Nitrokey/nitrokey-fido2-firmware/master/STABLE_VERSION",
    {cache: "no-store"}
  );
  let stable_version_github = (await response.text()).trim();
  console.log("STABLE_VERSION GITHUB", stable_version_github);

  var response = await fetch(
    "data/STABLE_VERSION",
    {cache: "no-store"}
  );
  let stable_version_fetched = (await response.text()).trim();
  console.log("STABLE_VERSION FETCHED", stable_version_fetched);

  if (stable_version_github !== stable_version_fetched) {
    app.stable_version = "fetched firmware version mismatch: update app has " + stable_version_fetched + ', but latest is: ' + stable_version_github;
    console.log(app.stable_version);
    app.correct_firmware = false;
  } else {
    app.stable_version = stable_version_fetched;
    app.stable_version_parts = new Uint8Array(stable_version_fetched.split(".").map(Number));
    app.correct_firmware = true;
  }
}

async function prepare() {
  let myStorage = window.localStorage;
  let status = localStorage.getItem('update');
  // if (status === 'in-progress'){
  //   update();
  // }

  await inspect_browser();
  await fetch_stable_version();
  // await check_version();
}

async function create_direct_attestation(timeout) {
  // random nonce
  var challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  // our relying party
  let rp_id = window.location.hostname;

  // GOAL: register a key signed by key's attestation certificate
  let publicKeyCredentialCreationOptions = {
    rp: {
      name: 'Nitrokey Web Update',
      id: rp_id,
    },
    authenticatorSelection: {
      userVerification: 'discouraged',
    },
    attestation: 'direct',

    challenge,

    pubKeyCredParams: [
      {type: 'public-key', alg: -7},
    ],

    user: {
      id: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
      name: "test-email@nitrokey.com",
      displayName: "Nitrokey test user",
    },

    timeout: timeout,
    excludeCredentials: [],
  };

  return navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions
  });
}

async function cancel_animation() {
  app.cancel_animation = true;
  app.reply_wait = 0;
}

async function run_animation(time_seconds) {
  app.cancel_animation = false;
  const update_ms = 500;
  const total_time_ms = time_seconds * 1000;
  const iterations = total_time_ms / update_ms;
  const idelay = total_time_ms / iterations;
  for (let i = 0; i <= iterations; i++) {
    app.reply_wait = i / iterations * 100;
    await sleep(idelay);
    if (app.cancel_animation) {
      app.reply_wait = 0;
      break;
    }
  }
}

async function inspect() {
  try{
    return await inspect_();
  } catch (e) {
    console.log(e);
    app.app_step = const_app_steps.update_failure;
  }
}

async function inspect_() {
  await reset_messages();
  app.app_step = const_app_steps.inspect;
  app.ask_for_attestation = true;
  app.is_solo_secure = null;
  app.is_solo_hacker = null;
  console.log("app.solo_version", app.solo_version);
  console.log("PRE-CHECKING IF IN BOOTLOADER");

  app.what_is_it = default_device; //set default device
  // await sleep(500);
  app.app_step = const_app_steps.bootloader_check;
  try {
    run_animation(15);
    if (await is_bootloader()) {
      app.app_step = const_app_steps.after_inspection;
      app.ask_for_attestation = null;
      app.cannot_inspect = true;
      app.cancel_animation = true;
      return;
    }
    //
    // console.log("ASKING FOR ATTESTATION");
    // const credential = await create_direct_attestation();
    // app.ask_for_attestation = null;
    //
    // // let utf8_decoder = new TextDecoder('utf-8');
    // // const client_data_json = utf8_decoder.decode(credential.response.clientDataJSON);
    // // let client_data = JSON.parse(client_data_json);
    // const attestation = CBOR.decode(credential.response.attestationObject);
    // const certificate = attestation.attStmt.x5c[0];
    // const certificate_fingerprint = sha256(certificate);
    // what_is_it = known_certs_lookup[certificate_fingerprint];
    // app.what_is_it = what_is_it;
  } catch (e) {
    app.app_step = const_app_steps.communication_error;
    app.ask_for_attestation = null;
    console.log("Failed running inspection");
    // app.cannot_inspect = true;
    app.cancel_animation = true;
    return;
  }

  if (typeof what_is_it === "undefined") {
    // console.log("UNKNOWN ATTESTATION CERTIFIATE", certificate_fingerprint);
  } else {
    app.is_solo_secure = true;
  }

  // now we know a key is plugged in
  await check_version();
  app.cancel_animation = true;

  const need = app.stable_version_parts;
  const have = app.solo_version_parts;
  console.log("NEED", need);
  console.log("HAVE", have);

  if (have == null) {
    app.needs_update = true;
  } else {
    app.needs_update =
      (need[0] > have[0])
      || (need[0] === have[0] && need[1] > have[1])
      || (need[0] === have[0] && need[1] === have[1] && need[2] > have[2])
    ;
  }
    console.log("Forcing true to update. Previous value: ", app.needs_update);
    app.needs_update = true;

  app.app_step = const_app_steps.after_inspection;
}

async function fetch_firmware() {
  // TODO: cache downloads
  url_base = "data/";
  let fname = firmware_file_name[app.what_is_it]

  if (!app.stable_version){
    console.log("Invalid stable version", app.stable_version);
    throw "Invalid stable version";
  }

  let file_url = url_base + fname + app.stable_version + ".json";
  console.log(file_url);

  let fetched = await fetch(file_url);
  if (!fetched.ok){
    app.update_failure_reason = fetched.statusText + ' at ' + fetched.url;
  }
  let content = await fetched.json();

  let firmware = websafe2string(content.firmware);
  var signature = websafe2array(content.signature);

  return {
    firmware: firmware,
    signature: signature,
  }

}


async function is_bootloader() {
  app.device_state = const_device_state.not_set;

  const response = await ctaphid_via_webauthn(CMD.boot_check, null, null, 1000);
  console.log("Boot check", response);
  if (response === undefined) {
    app.device_state = const_device_state.not_available;
    throw "Device not available";
  }

  const _is_bootloader = (response !== null);
  console.log("IS BOOTLOADER", _is_bootloader);
  if (_is_bootloader) {
    app.device_state = const_device_state.bootloader;
    const boot_pubkey = await ctaphid_via_webauthn(CMD.boot_pubkey, null, null, 1000);
    app.bootloader_pubkey = sha256(boot_pubkey);
    console.log("Boot pubkey hashed", app.bootloader_pubkey);
    const device_name = known_pubkey_lookup[app.bootloader_pubkey];
    const boot_version = await ctaphid_via_webauthn(CMD.boot_version, null, null, 1000);
    console.log("Device name detected from pubkey", device_name);
    console.log("Boot version", boot_version);
    // const boot_version_s = new TextDecoder("utf-8").decode(boot_version);
    // app.bootloader_version = boot_version_s;
    app.bootloader_version = boot_version;
    // app.what_is_it = device_name + ' (bootloader mode, version: ' + app.bootloader_version.slice(0,3) + ' )';
    app.what_is_it = device_name;
  } else {
    app.device_state = const_device_state.normal_mode;
  }
  return _is_bootloader;
}

async function update_hacker() {
  await update_secure();
}

async function update_secure() {
  app.is_solo_hacker = false;
  app.is_solo_secure = true;
  // app.advanced_mode = false;
  await update();
}

function update_failure() {
  console.log("...FAILURE");
  app.update_failure = true;
  app.update_status = "FLASHING FIRMWARE FAILED";
  app.app_step = const_app_steps.update_failure;
  app.update_ongoing = false;
}

async function update() {
  try{
    return await update_();
  } catch (e) {
    console.log(e);
    app.app_step = const_app_steps.update_failure;
  }
}

async function update_() {
  app.after_update_firmware_version = '';
  await reset_messages();

  if (app.user_selected_device) {
    app.what_is_it = app.user_selected_device;
  }
  run_animation(15*5*2);
  let bootloader_exec_success = false;
  app.app_step = const_app_steps.bootloader_execution_start;
  for (let i = 0; i < 5; i++) {
    app.bootloader_execution_attempt = i + 1;
    try {
      sleep(50);
      if (!await is_bootloader()) {
        sleep(50);
        // ask for running the bootloader
        await run_bootloader();
      } else {
        bootloader_exec_success = true;
        break;
      }
    } catch (e) {
    }
  }

  if (!bootloader_exec_success) {
    app.app_step = const_app_steps.update_failure;
    return;
  }

  app.update_ongoing = true;
  // app.needs_update = false;

  app.update_status = "DOWNLOADING FIRMWARE";
  let signed_firmware = await fetch_firmware();
  app.signed_firmware = signed_firmware;

  let firmware = signed_firmware.firmware;
  let signature = signed_firmware.signature;

  let blocks = MemoryMap.fromHex(firmware);
  let addresses = blocks.keys();

  let addr = addresses.next();
  const chunk_size = CONST_chunk_size;
  console.log("WRITING...");
  app.update_status = "Update is running";
  app.app_step = const_app_steps.update_ongoing;
  app.p_progress = 0;

  let myStorage = window.localStorage;
  localStorage.setItem('update', 'in-progress');
  // localStorage.setItem('u-state', 0);

  const starti = parseInt(localStorage.getItem('u-state'));

  while (!addr.done) {
    const data = blocks.get(addr.value);
    for (let i = starti; i < data.length; i += chunk_size) {

      await sleep(20);
      if (!app.cancel_animation && i>0){
        cancel_animation();
      }
      const chunk = data.slice(i, i + chunk_size);

      localStorage.setItem('u-state', i+chunk_size);

      while(true){
        const p = await ctaphid_via_webauthn(
          CMD.boot_write,
          addr.value + i,
          chunk
        );
        await sleep(20);
        if (typeof p === "undefined" || p.status === 'CTAP1_SUCCESS') {
          console.log("Failed reply: ", p);
          console.log("retry for ", i);
          // update_failure();
          // return;
        } else {
          break;
        }
      }
      // TEST(p.status !== 'CTAP1_SUCCESS', 'Device wrote data');

      const progress = (((i / data.length) * 100 * 100) | 0) / 100;
      if (i % 1000 === 0)
        console.log("PROGRESS:", progress);
      app.p_progress = Math.round(progress);
      app.update_progress = "Progress: " + progress + "%";
    }

    addr = addresses.next();
  }
  // app.update_progress = "Progress: 100%";
  app.update_progress = null;
  app.p_progress = null;
  console.log("...DONE");

  app.update_status = "VERIFYING FIRMWARE SIGNATURE";
  p = await ctaphid_via_webauthn(
    CMD.boot_done, 0x8000, signature
  );
  app.update_status = null;
  app.update_success = true;
  app.update_ongoing = false;

  app.signed_firmware = null;
  await check_version();
  app.app_step = const_app_steps.update_success;
}

async function reload_page() {
  location.reload();
}
