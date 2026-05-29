import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadString } from "firebase/storage";
const app = initializeApp({ apiKey:"AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4", projectId:"catalog-58ec8", storageBucket:"catalog-58ec8.firebasestorage.app", appId:"1:1055844775598:web:4a7d14594fc5498c2a1f3f"});
const s = getStorage(app);
const r = ref(s, "products/_t.txt");
try { await uploadString(r, "hi"); } catch (e) {
  console.log(JSON.stringify(e.customData, null, 2));
  console.log("server:", e.serverResponse);
}
process.exit(0);
