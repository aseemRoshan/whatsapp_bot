const socket = io('https://whatsapp-bot-txcr.onrender.com/');
console.log('Socket.IO initialized');

const loginButton = document.getElementById('google-login');
loginButton.addEventListener('click', () => {
  if (window.firebaseAuth && window.firebaseAuth.signInWithGoogle) {
    window.firebaseAuth.signInWithGoogle();
  } else {
    console.error('Firebase authentication not initialized yet');
    alert('Please wait a moment and try again.');
  }
});

// Check session on page load
document.addEventListener('DOMContentLoaded', () => {
  const idToken = localStorage.getItem('idToken');
  if (idToken) {
    console.log('Found existing idToken, checking session...');
    checkUserStatus(idToken);
  } else {
    console.log('No idToken found, showing login page');
  }
});

socket.on('connect', () => {
  console.log('Connected to Socket.IO server');
});

socket.on('qr', (data) => {
  console.log('QR received:', data);
  document.getElementById('qr-loading').style.display = 'none'; // Hide spinner
  const qrImage = document.getElementById('qr-code');
  qrImage.src = data.qr;
  qrImage.style.display = 'block'; // Show QR code
});

socket.on('authenticated', (data) => {
  console.log('Authenticated event received:', data);
  document.getElementById('qr-container').style.display = 'none';
  document.getElementById('connecting-container').style.display = 'block'; // Show connecting spinner
  setTimeout(() => {
    console.log('Transitioning to setup page with data:', data);
    document.getElementById('connecting-container').style.display = 'none';
    document.getElementById('setup-container').style.display = 'block';
    loadSetupData(null, data.groups, data.contacts);
  }, 1500); // 1.5s delay for WhatsApp data fetching
});

socket.on('disconnect', () => {
  console.log('Disconnected from Socket.IO server');
});

function checkUserStatus(idToken) {
  document.getElementById('login-container').style.display = 'none';
  document.getElementById('connecting-container').style.display = 'block'; // Show connecting spinner initially

  fetch('/user-status', {
    method: 'GET',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    }
  })
    .then(response => response.json())
    .then(data => {
      const userId = JSON.parse(atob(idToken.split('.')[1])).sub; // Extract userId from token
      console.log('User ID:', userId, 'User status:', data);
      socket.emit('register-user', userId); // Register user with Socket.IO

      if (data.authenticated) {
        // Existing user: go directly to setup page after a short delay
        console.log('Existing user detected, loading setup page');
        setTimeout(() => {
          document.getElementById('connecting-container').style.display = 'none';
          document.getElementById('setup-container').style.display = 'block';
          loadSetupData(data.hasSetup ? data.setup : null, data.groups, data.contacts);
          if (data.hasSetup && data.setup.isBotRunning) {
            document.getElementById('stop-bot').style.display = 'block';
          }
        }, 1000); // 1s delay to simulate fetching, adjust as needed
      } else {
        // New user: show QR code page
        console.log('New user, showing QR page');
        document.getElementById('connecting-container').style.display = 'none';
        document.getElementById('qr-container').style.display = 'block';
        if (data.qr) {
          document.getElementById('qr-loading').style.display = 'none';
          document.getElementById('qr-code').src = data.qr;
          document.getElementById('qr-code').style.display = 'block';
        }
      }
    })
    .catch(err => {
      console.error('Error checking user status:', err);
      document.getElementById('connecting-container').style.display = 'none';
      document.getElementById('login-container').style.display = 'block';
      localStorage.removeItem('idToken'); // Clear invalid token
    });
}

function loadSetupData(setup, groups, contacts) {
  console.log('Loading setup data:', { setup, groups, contacts });
  const groupSelect = document.getElementById('group-id');
  groupSelect.innerHTML = '<option value="">Select a group</option>';
  groups.forEach(group => {
    const option = document.createElement('option');
    option.value = group.id;
    option.text = group.name || 'Unnamed Group';
    groupSelect.appendChild(option);
  });

  window.contacts = contacts || [];
  const studentSelect = document.querySelector('.student-whatsapp');
  studentSelect.innerHTML = '<option value="">Select a contact</option>';
  contacts.forEach(contact => {
    const option = document.createElement('option');
    option.value = contact.id;
    option.text = contact.name;
    studentSelect.appendChild(option);
  });

  if (setup) {
    document.getElementById('group-id').value = setup.groupId || '';
    document.getElementById('batch').value = setup.batch || '';

    const [reportHours, reportMinutes] = setup.reportTime.split(':').map(Number);
    const [startHours, startMinutes] = setup.startTime.split(':').map(Number);
    
    document.getElementById('report-hours').value = reportHours % 12 || 12;
    document.getElementById('report-minutes').value = reportMinutes;
    document.getElementById('report-period').value = reportHours >= 12 ? 'PM' : 'AM';
    
    document.getElementById('start-hours').value = startHours % 12 || 12;
    document.getElementById('start-minutes').value = startMinutes;
    document.getElementById('start-period').value = startHours >= 12 ? 'PM' : 'AM';

    const studentsList = document.getElementById('students-list');
    studentsList.innerHTML = '';
    setup.students.forEach(student => {
      const studentDiv = document.createElement('div');
      studentDiv.className = 'student-entry';
      studentDiv.innerHTML = `
        <input type="text" placeholder="Name" class="student-name" value="${student.name}">
        <select class="input-type">
          <option value="contact" ${student.whatsappId.endsWith('@c.us') && contacts.some(c => c.id === student.whatsappId) ? 'selected' : ''}>Select Contact</option>
          <option value="manual" ${!contacts.some(c => c.id === student.whatsappId) ? 'selected' : ''}>Enter Number</option>
        </select>
        <select class="student-whatsapp contact-input" style="display: ${student.whatsappId.endsWith('@c.us') && contacts.some(c => c.id === student.whatsappId) ? 'block' : 'none'};">
          <option value="">Select a contact</option>
        </select>
        <input type="tel" class="student-number manual-input" placeholder="Enter phone number (e.g., 9123456789)" style="display: ${!contacts.some(c => c.id === student.whatsappId) ? 'block' : 'none'};" value="${student.whatsappId.startsWith('91') && student.whatsappId.endsWith('@c.us') ? student.whatsappId.slice(2, -5) : ''}">
        <button onclick="removeStudent(this)">Remove</button>
      `;
      const select = studentDiv.querySelector('.student-whatsapp');
      contacts.forEach(contact => {
        const option = document.createElement('option');
        option.value = contact.id;
        option.text = contact.name;
        if (contact.id === student.whatsappId) option.selected = true;
        select.appendChild(option);
      });
      studentsList.appendChild(studentDiv);
      studentDiv.querySelector('.input-type').addEventListener('change', toggleInputType);
    });
  }

  document.querySelectorAll('.input-type').forEach(select => {
    select.addEventListener('change', toggleInputType);
  });
}

function toggleInputType(event) {
  const studentEntry = event.target.closest('.student-entry');
  const contactInput = studentEntry.querySelector('.contact-input');
  const manualInput = studentEntry.querySelector('.manual-input');
  if (event.target.value === 'contact') {
    contactInput.style.display = 'block';
    manualInput.style.display = 'none';
  } else {
    contactInput.style.display = 'none';
    manualInput.style.display = 'block';
  }
}

function addStudent() {
  const studentDiv = document.createElement('div');
  studentDiv.className = 'student-entry';
  studentDiv.innerHTML = `
    <input type="text" placeholder="Name" class="student-name">
    <select class="input-type">
      <option value="contact">Select Contact</option>
      <option value="manual">Enter Number</option>
    </select>
    <select class="student-whatsapp contact-input" style="display: block;">
      <option value="">Select a contact</option>
    </select>
    <input type="tel" class="student-number manual-input" placeholder="Enter phone number (e.g., 9123456789)" style="display: none;">
    <button onclick="removeStudent(this)">Remove</button>
  `;
  const select = studentDiv.querySelector('.student-whatsapp');
  if (!window.contacts || window.contacts.length === 0) {
    console.log('No contacts available to populate new dropdown');
  } else {
    window.contacts.forEach(contact => {
      const option = document.createElement('option');
      option.value = contact.id;
      option.text = contact.name;
      select.appendChild(option);
    });
  }
  document.getElementById('students-list').appendChild(studentDiv);
  studentDiv.querySelector('.input-type').addEventListener('change', toggleInputType);
}

function removeStudent(button) {
  button.parentElement.remove();
}

function saveSetup() {
  const groupId = document.getElementById('group-id').value;
  const batch = document.getElementById('batch').value.trim();
  
  let reportHours = parseInt(document.getElementById('report-hours').value);
  const reportMinutes = document.getElementById('report-minutes').value.padStart(2, '0');
  const reportPeriod = document.getElementById('report-period').value;
  if (reportPeriod === 'PM' && reportHours !== 12) reportHours += 12;
  if (reportPeriod === 'AM' && reportHours === 12) reportHours = 0;
  const reportTime = `${reportHours.toString().padStart(2, '0')}:${reportMinutes}`;

  let startHours = parseInt(document.getElementById('start-hours').value);
  const startMinutes = document.getElementById('start-minutes').value.padStart(2, '0');
  const startPeriod = document.getElementById('start-period').value;
  if (startPeriod === 'PM' && startHours !== 12) startHours += 12;
  if (startPeriod === 'AM' && startHours === 12) startHours = 0;
  const startTime = `${startHours.toString().padStart(2, '0')}:${startMinutes}`;

  const students = Array.from(document.getElementsByClassName('student-entry')).map(entry => {
    const name = entry.querySelector('.student-name').value;
    const inputType = entry.querySelector('.input-type').value;
    let whatsappId;
    if (inputType === 'contact') {
      whatsappId = entry.querySelector('.student-whatsapp').value;
      console.log(`[DEBUG] Contact selected for ${name}: ${whatsappId}`);
    } else {
      const phoneNumber = entry.querySelector('.student-number').value;
      if (!/^[6-9]\d{9}$/.test(phoneNumber)) {
        alert(`Invalid phone number for ${name}: ${phoneNumber}`);
        return null;
      }
      whatsappId = `91${phoneNumber}@c.us`;
      console.log(`[DEBUG] Manual ID constructed for ${name}: ${whatsappId}`);
    }
    return { name, whatsappId };
  }).filter(student => student !== null);

  if (!groupId || !batch || !reportTime || !startTime || students.length === 0 || students.some(s => !s.name || !s.whatsappId)) {
    alert('Please fill all fields correctly');
    return;
  }

  const startInMinutes = startHours * 60 + parseInt(startMinutes);
  const reportInMinutes = reportHours * 60 + parseInt(reportMinutes);
  if (startInMinutes >= reportInMinutes) {
    alert('Start time must be before report time');
    return;
  }

  console.log('Saving setup:', { groupId, batch, reportTime, startTime, students });
  const idToken = localStorage.getItem('idToken');
  fetch('/setup', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({ groupId, batch, reportTime, startTime, students })
  })
    .then(response => response.json())
    .then(data => {
      console.log('Setup response:', data);
      if (data.success) {
        alert('Setup complete! Bot is running with your settings.');
        document.getElementById('stop-bot').style.display = 'block';
      } else {
        alert('Error: ' + data.error);
      }
    })
    .catch(err => console.error('Error saving setup:', err));
}

function stopBot() {
  if (confirm('Are you sure you want to stop the bot?')) {
    const idToken = localStorage.getItem('idToken');
    fetch('/stop', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      }
    })
      .then(response => response.json())
      .then(data => {
        console.log('Stop response:', data);
        if (data.success) {
          alert('Bot stopped successfully.');
          document.getElementById('stop-bot').style.display = 'none';
        } else {
          alert('Error: ' + data.error);
        }
      })
      .catch(err => console.error('Error stopping bot:', err));
  }
}

function logout() {
  Swal.fire({
    title: 'Are you sure you want to logout?',
    text: 'This will stop the bot and end your current session. Your WhatsApp connection and setup data will be preserved, but you’ll need to log in again to resume.',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#4361ee',
    cancelButtonColor: '#ff4b6b',
    confirmButtonText: 'Yes, logout',
    cancelButtonText: 'No, stay logged in'
  }).then((result) => {
    if (result.isConfirmed) {
      const idToken = localStorage.getItem('idToken');
      fetch('/logout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        }
      })
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            localStorage.removeItem('idToken');
            window.location.reload();
          } else {
            Swal.fire('Error', data.error, 'error');
          }
        })
        .catch(err => {
          console.error('Error during logout:', err);
          Swal.fire('Error', 'Something went wrong during logout.', 'error');
        });
    }
  });
}