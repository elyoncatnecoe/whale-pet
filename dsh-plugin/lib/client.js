window.__ModuleLoader__.load({
	id: "dsh-plugin-whale-pet-desktop",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const slots = require("@deepseek-ai/dsh-client-ui-slots");

		// 命名空间与插槽 id 都带 -desktop 后缀：DSH 的 sidebar.footer.action 是
		// 列表插槽，只有「用别人已占用的 id」才会替换；用独有 id 一律新增。
		// 这样虎鲸桌宠可以和别的宠物插件共存，不会互相顶掉。
		const NS = "whale-pet-desktop";
		const RPC = "/whale-pet-desktop/rpc";
		const SLOT_ID = "whale-pet-desktop";

		/** 调 Host 半边。 */
		async function callHost(method, args) {
			const res = await fetch(RPC, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ method, args }),
			});
			if (!res.ok) throw new Error(`whale-pet rpc HTTP ${res.status}`);
			return res.json();
		}

		/** 侧边栏底部按钮：打开/关闭桌宠面板。 */
		function WhalePetButton(props) {
			const [open, setOpen] = React.useState(false);
			const [status, setStatus] = React.useState({ running: false });
			const [balance, setBalance] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);

			// 打开时轮询状态。
			React.useEffect(() => {
				if (!open) return;
				let alive = true;
				const tick = async () => {
					try {
						const s = await callHost("status");
						if (alive) { setStatus(s); setError(s.error ?? null); }
					} catch (e) {
						if (alive) setError(String(e.message || e));
					}
				};
				tick();
				const id = setInterval(tick, 3000);
				return () => { alive = false; clearInterval(id); };
			}, [open]);

			const toggle = async () => {
				setBusy(true); setError(null);
				try {
					const r = await callHost(status.running ? "stop" : "start");
					if (r && r.ok === false) setError(r.error);
					const s = await callHost("status");
					setStatus(s);
				} catch (e) {
					setError(String(e.message || e));
				} finally { setBusy(false); }
			};

			// 依赖缺失时的一键安装（主要是 electron，约 180MB）。
			// pnpm 10+ 默认拦截依赖的 postinstall，所以只能由用户在此显式触发。
			const doInstall = async () => {
				setBusy(true); setError("正在安装依赖（约 180MB，请耐心等待）…");
				try {
					const r = await callHost("install");
					if (r && r.ok === false) setError(r.error);
					else setError(null);
					setStatus(await callHost("status"));
				} catch (e) {
					setError(String(e.message || e));
				} finally { setBusy(false); }
			};

			const checkBalance = async () => {
				setBusy(true); setError(null);
				try {
					const b = await callHost("balance");
					setBalance(b);
					if (b && b.ok === false) setError(b.error);
				} catch (e) { setError(String(e.message || e)); }
				finally { setBusy(false); }
			};

			const label = "🐋 虎鲸桌宠";

			// 关闭状态：只画一个可点的按钮。
			if (!open) {
				return React.createElement("button", {
					type: "button",
					onClick: () => setOpen(true),
					title: label,
					style: {
						display: "flex", alignItems: "center", gap: "8px",
						width: "100%", padding: "8px 10px", margin: "2px 0",
						background: "transparent", border: "none", borderRadius: "12px",
						color: "var(--dsw-alias-label-primary, inherit)",
						font: "inherit", fontSize: "14px", cursor: "pointer", textAlign: "left",
					},
				}, label);
			}

			const money = balance && balance.ok
				? `${balance.currency === "USD" ? "$" : "¥"}${Number(balance.total).toFixed(2)}`
				: null;
			const low = balance && balance.ok && balance.total < 1;

			const row = (children) => React.createElement("div", {
				style: { display: "flex", alignItems: "center", gap: "8px", margin: "6px 0" },
			}, children);

			const btn = (text, onClick, danger) => React.createElement("button", {
				type: "button",
				onClick,
				disabled: busy,
				style: {
					padding: "5px 12px", borderRadius: "8px", cursor: busy ? "default" : "pointer",
					border: "1px solid var(--dsw-alias-border-l2, #444)",
					background: danger ? "var(--dsw-alias-bg-danger, #5a1f1f)" : "var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))",
					color: "var(--dsw-alias-label-primary, inherit)",
					font: "inherit", fontSize: "13px", opacity: busy ? 0.6 : 1,
				},
			}, text);

			return React.createElement("div", {
				style: {
					position: "fixed", right: "20px", bottom: "20px", zIndex: 9999,
					width: "260px", padding: "14px 16px", borderRadius: "16px",
					background: "var(--dsw-alias-bg-layer-2, #1e1e24)",
					boxShadow: "var(--dsw-elevation-prominent, 0 8px 32px rgba(0,0,0,.45))",
					color: "var(--dsw-alias-label-primary, #eee)",
					font: "inherit", fontSize: "14px",
				},
			},
				row([
					React.createElement("strong", { key: "t", style: { flex: 1 } }, label),
					btn("✕", () => setOpen(false)),
				]),
				row([
					React.createElement("span", { key: "s", style: { flex: 1 } },
						status.installing ? "⏳ 安装依赖中…"
							: status.running ? "🟢 运行中"
							: status.ready ? "⚪ 未启动"
							: "🔧 依赖未装"),
					btn(status.running ? "关闭" : "启动", toggle),
				]),
				// 依赖缺失时给一个明确的一键安装入口，否则用户只会看到「启动失败」
				!status.ready ? row([
					React.createElement("span", { key: "d", style: { flex: 1, fontSize: "12px", opacity: 0.75 } },
						"首次使用需装 electron"),
					btn(status.installing ? "安装中…" : "安装依赖", doInstall),
				]) : null,
				row([
					React.createElement("span", { key: "b", style: { flex: 1 } },
						money ? `${low ? "⚡ " : "💰 "}余额 ${money}` : "💰 未查询"),
					btn("查余额", checkBalance),
				]),
				low ? React.createElement("div", {
					style: { color: "#f0a020", fontSize: "12px", marginTop: "4px" },
				}, "⚡ 余额偏低，记得充值") : null,
				error ? React.createElement("div", {
					style: { color: "#ff6b6b", fontSize: "12px", marginTop: "6px", wordBreak: "break-all" },
				}, error) : null,
			);
		}

		/** 注册到侧边栏底部的动作区。 */
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				// 独有 id：列表插槽会把它新增在已有序项旁边，而不是替换别人。
				// 其他宠物插件只要用它们自己的 id，就能与本插件共存。
				id: SLOT_ID,
				order: 100,
				label: () => "🐋 虎鲸桌宠",
			}, WhalePetButton));
		}

		const inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});