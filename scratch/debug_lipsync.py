import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

options = Options()
options.add_argument('--headless')
options.add_argument('--window-size=1280,800')

driver = webdriver.Chrome(options=options)
try:
    driver.get('http://127.0.0.1:5000/')
    time.sleep(1)

    setup_js = """
    window.lipSyncTrace = [];
    document.getElementById("landing-page").style.display = "none";

    setInterval(() => {
        const mouth = document.getElementById("avatar-mouth");
        window.lipSyncTrace.push({
            time: (Date.now() - window.startTime) / 1000,
            isSpeaking: typeof isSpeaking !== "undefined" ? isSpeaking : null,
            avatarEnabled: typeof avatarEnabled !== "undefined" ? avatarEnabled : null,
            mouthTransform: mouth ? mouth.style.transform : "none",
        });
    }, 100);
    window.startTime = Date.now();
    """
    driver.execute_script(setup_js)
    time.sleep(0.5)

    # User types message and hits enter (NO manual avatar toggle needed!)
    input_box = driver.find_element(By.ID, 'user-input')
    input_box.send_keys('Tell me a sentence about space.\n')
    time.sleep(6)

    trace = driver.execute_script("return window.lipSyncTrace;")
    print(f"=== LIP SYNC TRACE OUT OF THE BOX ({len(trace)} samples) ===")
    active_samples = [s for s in trace if s['isSpeaking'] or s['mouthTransform'] != '']
    print(f"Total samples with active animation/speaking state: {len(active_samples)}")
    for sample in active_samples[:20]:
        print(sample)

finally:
    driver.quit()
