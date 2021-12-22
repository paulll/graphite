// ==UserScript==
// @name graphite-vk
// @author paulll
// @description graphite vk integration
// @version 1.0.0
// @homepage https://github.com/paulll/graphite
// @include https://vk.com/*
// @exclude https://vk.com/page*
// @exclude https://vk.com/group*
// @exclude https://vk.com/wall*
// @exclude https://vk.com/photo*
// @exclude https://vk.com/page*
// @grant none
// ==/UserScript==

(function() {
	'use strict';

	const main = () => {
		const root = document.getElementById('profile_short');
		const id = document.location.href.split('/').pop().split('?').shift();

		if (root) {
			dApi.call('users.get', {user_ids: id, v:5.89}, (data) => {
				if (!data.response)
					return console.error('[graphite]', data);
				const root = document.getElementById('profile_short');
				const last = Array.from(root.querySelectorAll('.profile_info_row')).pop();
				const data_row = document.createElement('div');
				const row_left = document.createElement('div');
				const row_right = document.createElement('div');
				const link = document.createElement('a');
				const access = data.response[0].is_closed;

				data_row.className = 'clear_fix profile_info_row';
				row_left.className = 'label fl_l';
				row_right.className = 'labeled';

				row_left.textContent = 'Посмотреть граф друзей:';

				link.textContent =  'Graphite';
				link.target = '_blank';

				link.href = `https://paulll.cc/graphite/main.html#&id=${data.response[0].id}&token=${dApi.access_token}`;

				row_right.appendChild(link);
				data_row.appendChild(row_left);
				data_row.appendChild(row_right);
				root.insertBefore(data_row, last.nextSibling);
			});
		}
	};

	if (window.hasOwnProperty('dApi')) {
		main();
	} else {
		const vkopt_api = document.createElement('script');
		vkopt_api.src = 'https://cdn.jsdelivr.net/gh/VkOpt/VkOpt/source/vk_lib.js';
		vkopt_api.onload = main;
		document.getElementsByTagName('head')[0].appendChild(vkopt_api);
	}
})();