var firebaseConfig = {
  apiKey: "AIzaSyC-NxLFokWU63AwRi4Tyo8MiwIYTM8rSiY",
  authDomain: "dopetool.firebaseapp.com",
  databaseURL: "https://dopetool-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "dopetool",
  storageBucket: "dopetool.firebasestorage.app",
  messagingSenderId: "426818140600",
  appId: "1:426818140600:web:9219be58586619b6f1b74d"
};

firebase.initializeApp(firebaseConfig);
var db = firebase.firestore();
