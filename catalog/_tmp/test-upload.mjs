import { initializeApp } from "firebase/app";
import { getStorage, ref, uploadString, getDownloadURL } from "firebase/storage";
const app = initializeApp({
  apiKey: "AIzaSyCamvdagAyxxmWVO3kOhRKO01tNyi4XCa4",
  authDomain: "catalog-58ec8.firebaseapp.com",
  projectId: "catalog-58ec8",
  storageBucket: "catalog-58ec8.firebasestorage.app",
  appId: "1:1055844775598:web:4a7d14594fc5498c2a1f3f",
});
const s = getStorage(app);
const r = ref(s, "products/_test.txt");
try {
  await uploadString(r, "hello");
  const u = await getDownloadURL(r);
  console.log("OK", u);
} catch (e) { console.error("FAIL", e.code, e.message); }
process.exit(0);
